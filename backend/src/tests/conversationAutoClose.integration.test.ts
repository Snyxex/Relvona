import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool } from "../db/index.js";
import { ConversationAutoCloseService } from "../services/conversationAutoCloseService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL are required");

async function main() {
  const admin = new pg.Client({ connectionString: adminUrl });
  const app = new pg.Client({ connectionString: appUrl });
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const customerA = randomUUID(); const customerB = randomUUID();
  const conversationA = randomUUID(); const conversationB = randomUUID();
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const asTenant = async (tenant: string, work: () => Promise<void>) => {
    await app.query("BEGIN");
    try { await app.query("SELECT set_config('app.organization_id', $1, true)", [tenant]); await work(); await app.query("COMMIT"); }
    catch (error) { await app.query("ROLLBACK"); throw error; }
  };
  await admin.connect(); await app.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Auto-close A', $2), ($3, 'Auto-close B', $4)", [tenantA, `auto-close-a-${tenantA}`, tenantB, `auto-close-b-${tenantB}`]);
    await asTenant(tenantA, async () => {
      await app.query("INSERT INTO organization_settings (organization_id, resolved_auto_close_hours) VALUES ($1, 1)", [tenantA]);
      await app.query("INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'auto-a@example.test', 'A')", [customerA, tenantA]);
      await app.query("INSERT INTO conversations (id, organization_id, customer_id, state, updated_at) VALUES ($1, $2, $3, 'RESOLVED', $4)", [conversationA, tenantA, customerA, old]);
    });
    await asTenant(tenantB, async () => {
      await app.query("INSERT INTO organization_settings (organization_id) VALUES ($1)", [tenantB]);
      await app.query("INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'auto-b@example.test', 'B')", [customerB, tenantB]);
      await app.query("INSERT INTO conversations (id, organization_id, customer_id, state, updated_at) VALUES ($1, $2, $3, 'RESOLVED', $4)", [conversationB, tenantB, customerB, old]);
    });
    assert.equal(await ConversationAutoCloseService.closeDue(tenantA), 1, "Configured tenant must close due conversations");
    assert.equal(await ConversationAutoCloseService.closeDue(tenantB), 0, "Auto-close must remain disabled until explicitly configured");
    await asTenant(tenantA, async () => {
      const closed = await app.query("SELECT state FROM conversations WHERE id = $1", [conversationA]);
      const timeline = await app.query("SELECT event_type FROM conversation_activities WHERE conversation_id = $1", [conversationA]);
      assert.equal(closed.rows[0].state, "CLOSED"); assert.equal(timeline.rows[0].event_type, "auto_closed");
    });
    await asTenant(tenantB, async () => {
      const open = await app.query("SELECT state FROM conversations WHERE id = $1", [conversationB]);
      assert.equal(open.rows[0].state, "RESOLVED");
    });
    console.log("Conversation auto-close integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[tenantA, tenantB]]).catch(() => undefined);
    await Promise.all([app.end(), admin.end(), closeDatabasePool()]);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
