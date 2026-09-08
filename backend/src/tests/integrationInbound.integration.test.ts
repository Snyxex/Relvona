import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import pg from "pg";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { externalActors, externalTicketMessages } from "../db/externalTicketMessageSchema.js";
import { integrationSyncExecutions } from "../db/integrationSyncSchema.js";
import { IntegrationConnectionService } from "../services/integrationConnectionService.js";
import { IntegrationInboundService } from "../services/integrationInboundService.js";
import { registerIntegrationSyncBridge } from "../services/integrationSyncBridge.js";
import { IntegrationSyncService } from "../services/integrationSyncService.js";
import { db } from "../db/index.js";
import { and, eq } from "drizzle-orm";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for inbound integration tests");

const organizationId = randomUUID();
const customerId = randomUUID();
const ticketId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });
const signingSecret = "zendesk-signing-secret-for-inbound-regression";

function signature(timestamp: string, rawBody: Buffer) {
  return crypto.createHmac("sha256", signingSecret).update(timestamp).update(rawBody).digest("base64");
}

async function enqueue(connectionId: string, payload: unknown, invocationId = `inv-${randomUUID()}`) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const timestamp = new Date().toISOString();
  return IntegrationInboundService.verifyAndEnqueue({ organizationId, connectionId, signature: signature(timestamp, rawBody), timestamp, invocationId, rawBody, payload });
}

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Inbound Tenant', $2)", [organizationId, `inbound-${organizationId}`]);
    await admin.query("INSERT INTO customers (id, organization_id, name, email) VALUES ($1, $2, 'Inbound Customer', 'inbound@example.test')", [customerId, organizationId]);
    await admin.query("INSERT INTO tickets (id, organization_id, customer_id, ticket_number, subject, priority, status, tags) VALUES ($1, $2, $3, 8101, 'Inbound ticket', 'normal', 'open', '[]'::jsonb)", [ticketId, organizationId, customerId]);

    const setup = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const connection = await IntegrationConnectionService.create({
        organizationId,
        provider: "zendesk",
        name: "Inbound Zendesk",
        config: { subdomain: "supportai-inbound", email: "agent@example.test" },
        credentials: { apiToken: "zendesk-inbound-test-token-long-enough" },
      });
      await IntegrationConnectionService.setZendeskWebhookSigningSecret(organizationId, connection.id, signingSecret);
      const createRule = await IntegrationSyncService.createRule({ organizationId, connectionId: connection.id, eventType: "ticket.created", action: "zendesk.create_ticket" });
      const updateRule = await IntegrationSyncService.createRule({ organizationId, connectionId: connection.id, eventType: "ticket.updated", action: "zendesk.update_ticket" });
      await IntegrationSyncService.setEnabled(organizationId, createRule.id, true);
      await IntegrationSyncService.setEnabled(organizationId, updateRule.id, true);
      await db.insert(integrationSyncExecutions).values({
        organizationId,
        ruleId: createRule.id,
        eventKey: `ticket.created:${ticketId}`,
        entityId: ticketId,
        status: "succeeded",
        externalId: "12345",
      });
      return { connection, updateRule };
    });

    registerIntegrationSyncBridge();

    const payload = { eventType: "ticket.updated" as const, ticket: { id: "12345", status: "solved", priority: "urgent" } };
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
    const timestamp = new Date().toISOString();
    const invocationId = `inv-${randomUUID()}`;

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const first = await IntegrationInboundService.verifyAndEnqueue({ organizationId, connectionId: setup.connection.id, signature: signature(timestamp, rawBody), timestamp, invocationId, rawBody, payload });
      assert.equal(first.accepted, true);
      assert.equal(first.duplicate, false);

      const duplicate = await IntegrationInboundService.verifyAndEnqueue({ organizationId, connectionId: setup.connection.id, signature: signature(timestamp, rawBody), timestamp, invocationId, rawBody, payload });
      assert.equal(duplicate.accepted, false);
      assert.equal(duplicate.duplicate, true, "same Zendesk invocation must be deduplicated");

      await assert.rejects(() => IntegrationInboundService.verifyAndEnqueue({ organizationId, connectionId: setup.connection.id, signature: "invalid-signature", timestamp, invocationId: `inv-${randomUUID()}`, rawBody, payload }), /signature/i);

      const staleTimestamp = new Date(Date.now() - 10 * 60_000).toISOString();
      await assert.rejects(() => IntegrationInboundService.verifyAndEnqueue({ organizationId, connectionId: setup.connection.id, signature: signature(staleTimestamp, rawBody), timestamp: staleTimestamp, invocationId: `inv-${randomUUID()}`, rawBody, payload }), /replay window/i);

      const processed = await IntegrationInboundService.processPending(organizationId);
      assert.equal(processed.succeeded, 1);
      assert.equal(processed.failed, 0);
    });

    const ticketResult = await admin.query("SELECT status, priority FROM tickets WHERE id = $1", [ticketId]);
    assert.equal(ticketResult.rows[0].status, "resolved");
    assert.equal(ticketResult.rows[0].priority, "urgent");

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const executions = await IntegrationSyncService.listExecutions(organizationId);
      assert.equal(executions.filter((row) => row.ruleId === setup.updateRule.id).length, 0, "Zendesk-sourced local updates must not enqueue an outbound update");
    });

    const customerComment = {
      eventType: "ticket.comment.created" as const,
      ticket: { id: "12345" },
      comment: {
        id: "90001",
        body: "I still need help with this issue.",
        public: true,
        createdAt: new Date().toISOString(),
        author: { id: "501", name: "External Customer", email: "customer@example.test", role: "end-user" as const },
      },
    };

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      assert.equal((await enqueue(setup.connection.id, customerComment)).accepted, true);
      const firstCommentProcess = await IntegrationInboundService.processPending(organizationId);
      assert.equal(firstCommentProcess.succeeded, 1, "end-user comment must be stored");

      assert.equal((await enqueue(setup.connection.id, customerComment)).accepted, true, "different invocation ids may repeat the same provider comment");
      const duplicateCommentProcess = await IntegrationInboundService.processPending(organizationId);
      assert.equal(duplicateCommentProcess.ignored, 1, "provider comment id must deduplicate repeated deliveries");

      const messages = await db.select().from(externalTicketMessages).where(and(eq(externalTicketMessages.organizationId, organizationId), eq(externalTicketMessages.ticketId, ticketId)));
      assert.equal(messages.length, 1);
      assert.equal(messages[0].content, customerComment.comment.body);
      assert.equal(messages[0].visibility, "public");

      const actors = await db.select().from(externalActors).where(and(eq(externalActors.organizationId, organizationId), eq(externalActors.connectionId, setup.connection.id)));
      assert.equal(actors.length, 1);
      assert.equal(actors[0].externalId, "501");
      assert.equal(actors[0].role, "end-user");
      assert.equal(actors[0].email, "customer@example.test");
    });

    const agentEcho = {
      eventType: "ticket.comment.created" as const,
      ticket: { id: "12345" },
      comment: { id: "90002", body: "Agent response echoed by Zendesk.", public: true, author: { id: "777", name: "Zendesk Agent", role: "agent" as const } },
    };
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await enqueue(setup.connection.id, agentEcho);
      const result = await IntegrationInboundService.processPending(organizationId);
      assert.equal(result.ignored, 1, "agent-authored Zendesk comments must not loop back into the local timeline");
      const messages = await db.select().from(externalTicketMessages).where(and(eq(externalTicketMessages.organizationId, organizationId), eq(externalTicketMessages.ticketId, ticketId)));
      assert.equal(messages.length, 1);
    });

    console.log("Zendesk inbound status, signature, replay, customer comment, deduplication, author separation, and loop-prevention tests passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
