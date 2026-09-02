import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL are required for the tenant-isolation integration test");

const organizationA = randomUUID();
const organizationB = randomUUID();
const customerA = randomUUID();
const customerB = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });
const app = new pg.Client({ connectionString: appUrl });

async function asTenant(organizationId: string, work: () => Promise<void>) {
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    await work();
    await app.query("COMMIT");
  } catch (error) {
    await app.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  await admin.connect();
  await app.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'RLS Tenant A', $2, $3), ($4, 'RLS Tenant B', $5, $6)", [organizationA, `rls-a-${organizationA}`, `key-a-${organizationA}`, organizationB, `rls-b-${organizationB}`, `key-b-${organizationB}`]);
    await asTenant(organizationA, async () => {
      await app.query("INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'a@example.test', 'A')", [customerA, organizationA]);
      const own = await app.query("SELECT id FROM customers WHERE id = $1", [customerA]);
      assert.equal(own.rowCount, 1, "Tenant A must read its own row");
      const crossTenant = await app.query("SELECT id FROM customers WHERE id = $1", [customerB]);
      assert.equal(crossTenant.rowCount, 0, "Tenant A must not read Tenant B rows");
    });
    await asTenant(organizationB, async () => {
      await app.query("INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'b@example.test', 'B')", [customerB, organizationB]);
    });
    await asTenant(organizationA, async () => {
      const crossTenant = await app.query("SELECT id FROM customers WHERE id = $1", [customerB]);
      assert.equal(crossTenant.rowCount, 0, "Tenant A must remain isolated after Tenant B writes");
    });
    console.log("Tenant RLS isolation integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationA, organizationB]]).catch(() => undefined);
    await app.end();
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
