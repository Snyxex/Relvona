import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool, db } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { webhookDeliveries, webhookEvents, webhookSubscriptions } from "../db/webhookSchema.js";
import { encryptSecret } from "../utils/crypto.js";
import { WebhookService } from "../services/webhookService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for webhook outbox integration tests");
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const subscriptionId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'Webhook Test', $2, $3), ($4, 'Other Webhook Test', $5, $6)",
      [organizationId, `webhook-${organizationId}`, `webhook-key-${organizationId}`, otherOrganizationId, `webhook-${otherOrganizationId}`, `webhook-key-${otherOrganizationId}`],
    );
    await admin.query(
      "INSERT INTO webhook_subscriptions (id, organization_id, name, url, event_types, encrypted_secret) VALUES ($1, $2, 'Primary', 'https://example.com/webhook', $3::jsonb, $4)",
      [subscriptionId, organizationId, JSON.stringify(["ticket.created"]), encryptSecret("whsec_test")],
    );

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const listed = await WebhookService.list(organizationId);
      assert.equal(listed.length, 1);
      assert.equal("encryptedSecret" in listed[0], false, "subscription list must never expose encrypted signing secrets");

      const event = await WebhookService.capture({
        type: "ticket.created",
        organizationId,
        conversationId: randomUUID(),
        payload: { ticketId: randomUUID(), subject: "Webhook test" },
        occurredAt: new Date(),
      });
      assert(event, "matching domain event must be persisted");

      const events = await db.select().from(webhookEvents);
      const deliveries = await db.select().from(webhookDeliveries);
      assert.equal(events.length, 1);
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0].subscriptionId, subscriptionId);
      assert.equal(deliveries[0].eventId, events[0].id);
      assert.equal(deliveries[0].status, "pending");
    });

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(otherOrganizationId);
      assert.equal((await db.select().from(webhookSubscriptions)).length, 0);
      assert.equal((await db.select().from(webhookEvents)).length, 0);
      assert.equal((await db.select().from(webhookDeliveries)).length, 0);
    });

    console.log("Webhook outbox integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
