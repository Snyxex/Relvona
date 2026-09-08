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
const unlinkedTicketId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });
const originalFetch = globalThis.fetch;

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Sync Tenant', $2)", [organizationId, `sync-${organizationId}`]);
    await admin.query("INSERT INTO customers (id, organization_id, name, email) VALUES ($1, $2, 'Sync Customer', 'sync@example.test')", [customerId, organizationId]);
    await admin.query("INSERT INTO tickets (id, organization_id, customer_id, ticket_number, subject, description, priority, status, tags) VALUES ($1, $2, $3, 7001, 'Sync issue', 'Created by sync regression test', 'high', 'open', '[]'::jsonb)", [ticketId, organizationId, customerId]);
    await admin.query("INSERT INTO tickets (id, organization_id, customer_id, ticket_number, subject, description, priority, status, tags) VALUES ($1, $2, $3, 7002, 'Unlinked issue', 'Must never create during update sync', 'normal', 'pending', '[]'::jsonb)", [unlinkedTicketId, organizationId, customerId]);

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

    const { createRule, updateRule } = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const created = await IntegrationSyncService.createRule({ organizationId, connectionId: connection.id, eventType: "ticket.created", action: "zendesk.create_ticket" });
      const updated = await IntegrationSyncService.createRule({ organizationId, connectionId: connection.id, eventType: "ticket.updated", action: "zendesk.update_ticket" });
      return { createRule: created, updateRule: updated };
    });
    assert.equal(createRule.enabled, false, "new automatic create sync rules must be disabled by default");
    assert.equal(updateRule.enabled, false, "new automatic update sync rules must be disabled by default");

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await IntegrationSyncService.setEnabled(organizationId, createRule.id, true);
      await IntegrationSyncService.setEnabled(organizationId, updateRule.id, true);
      const event = { type: "ticket.created" as const, organizationId, payload: { id: ticketId }, occurredAt: new Date() };
      await IntegrationSyncService.handleDomainEvent(event);
      await IntegrationSyncService.handleDomainEvent(event);
      const queued = await IntegrationSyncService.listExecutions(organizationId);
      assert.equal(queued.length, 1, "duplicate create events must create one sync execution");
      assert.equal(queued[0].status, "pending");
    });

    const requests: Array<{ url: string; method?: string; body: any }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method: init?.method, body });
      if (url.endsWith("/api/v2/tickets.json")) {
        assert.equal(init?.method, "POST");
        assert.equal(body.ticket.subject, "Sync issue");
        assert.equal(body.ticket.priority, "high");
        assert.equal(body.ticket.requester.email, "sync@example.test");
        return new Response(JSON.stringify({ ticket: { id: 12345 } }), { status: 201, headers: { "content-type": "application/json" } });
      }
      assert.equal(url, "https://supportai-test.zendesk.com/api/v2/tickets/12345.json");
      assert.equal(init?.method, "PUT");
      assert.equal(body.ticket.status, "solved");
      assert.equal(body.ticket.priority, "urgent");
      return new Response(JSON.stringify({ ticket: { id: 12345, status: "solved", priority: "urgent" } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const first = await IntegrationSyncService.processPending(organizationId);
      assert.equal(first.succeeded, 1);
      const second = await IntegrationSyncService.processPending(organizationId);
      assert.equal(second.processed, 0, "successful create sync must not be delivered twice");
      const executions = await IntegrationSyncService.listExecutions(organizationId);
      assert.equal(executions[0].status, "succeeded");
      assert.equal(executions[0].externalId, "12345");
    });
    assert.equal(requests.length, 1, "Zendesk must receive exactly one create request");

    const updateTimestamp = new Date("2026-09-08T10:15:00.000Z");
    await admin.query("UPDATE tickets SET status = 'resolved', priority = 'urgent', updated_at = $2 WHERE id = $1", [ticketId, updateTimestamp]);
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const event = { type: "ticket.updated" as const, organizationId, payload: { id: ticketId, updatedAt: updateTimestamp }, occurredAt: updateTimestamp };
      await IntegrationSyncService.handleDomainEvent(event);
      await IntegrationSyncService.handleDomainEvent(event);
      const before = await IntegrationSyncService.listExecutions(organizationId);
      assert.equal(before.filter((item) => item.eventKey.startsWith("ticket.updated:")).length, 1, "duplicate update events must queue exactly one execution");
      const result = await IntegrationSyncService.processPending(organizationId);
      assert.equal(result.succeeded, 1);
      const after = await IntegrationSyncService.listExecutions(organizationId);
      const updateExecution = after.find((item) => item.eventKey.startsWith(`ticket.updated:${ticketId}:`));
      assert.equal(updateExecution?.status, "succeeded");
      assert.equal(updateExecution?.externalId, "12345");
    });
    assert.equal(requests.length, 2, "Zendesk must receive one create and one linked update request");

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const event = { type: "ticket.updated" as const, organizationId, payload: { id: unlinkedTicketId, updatedAt: new Date("2026-09-08T10:16:00.000Z") }, occurredAt: new Date("2026-09-08T10:16:00.000Z") };
      await IntegrationSyncService.handleDomainEvent(event);
      const result = await IntegrationSyncService.processPending(organizationId);
      assert.equal(result.failed, 1, "update sync without a prior create link must fail safely");
      const executions = await IntegrationSyncService.listExecutions(organizationId);
      const failed = executions.find((item) => item.entityId === unlinkedTicketId);
      assert.equal(failed?.status, "failed");
      assert.match(failed?.error || "", /create sync must succeed first/i);
    });
    assert.equal(requests.length, 2, "unlinked update must not issue any external request");

    console.log("Integration sync create/update idempotency and linked Zendesk delivery tests passed.");
  } finally {
    globalThis.fetch = originalFetch;
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
