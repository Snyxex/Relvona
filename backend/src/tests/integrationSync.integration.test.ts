import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { IntegrationConnectionService } from "../services/integrationConnectionService.js";
import { IntegrationSyncService } from "../services/integrationSyncService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for integration sync tests");

const organizationId = randomUUID();
const customerId = randomUUID();
const ticketId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });
const originalFetch = globalThis.fetch;

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Sync Tenant', $2)", [organizationId, `sync-${organizationId}`]);
    await admin.query("INSERT INTO customers (id, organization_id, name, email) VALUES ($1, $2, 'Sync Customer', 'sync@example.test')", [customerId, organizationId]);
    await admin.query("INSERT INTO tickets (id, organization_id, customer_id, ticket_number, subject, description, priority, status, tags) VALUES ($1, $2, $3, 7001, 'Sync issue', 'Created by sync regression test', 'high', 'open', ARRAY[]::text[])", [ticketId, organizationId, customerId]);

    const connection = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return IntegrationConnectionService.create({
        organizationId,
        provider: "zendesk",
        name: "Sync Zendesk",
        config: { subdomain: "supportai-test", email: "agent@example.test" },
        credentials: { apiToken: "zendesk-test-token-long-enough-for-regression" },
      });
    });

    const rule = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return IntegrationSyncService.createRule({ organizationId, connectionId: connection.id, eventType: "ticket.created", action: "zendesk.create_ticket" });
    });
    assert.equal(rule.enabled, false, "new automatic sync rules must be disabled by default");

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await IntegrationSyncService.setEnabled(organizationId, rule.id, true);
      const event = { type: "ticket.created" as const, organizationId, payload: { id: ticketId }, occurredAt: new Date() };
      await IntegrationSyncService.handleDomainEvent(event);
      await IntegrationSyncService.handleDomainEvent(event);
      const queued = await IntegrationSyncService.listExecutions(organizationId);
      assert.equal(queued.length, 1, "duplicate domain events must create one sync execution");
      assert.equal(queued[0].status, "pending");
    });

    let requests = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests += 1;
      assert.equal(String(input), "https://supportai-test.zendesk.com/api/v2/tickets.json");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.ticket.subject, "Sync issue");
      assert.equal(body.ticket.priority, "high");
      assert.equal(body.ticket.requester.email, "sync@example.test");
      return new Response(JSON.stringify({ ticket: { id: 12345 } }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const first = await IntegrationSyncService.processPending(organizationId);
      assert.equal(first.succeeded, 1);
      const second = await IntegrationSyncService.processPending(organizationId);
      assert.equal(second.processed, 0, "successful sync executions must not be delivered twice");
      const executions = await IntegrationSyncService.listExecutions(organizationId);
      assert.equal(executions[0].status, "succeeded");
      assert.equal(executions[0].externalId, "12345");
    });
    assert.equal(requests, 1, "Zendesk must receive exactly one create request");

    console.log("Integration sync idempotency and worker delivery test passed.");
  } finally {
    globalThis.fetch = originalFetch;
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
