import { and, desc, eq, lt, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { customers, organizations, tickets } from "../db/schema.js";
import { integrationConnections } from "../db/integrationConnectionSchema.js";
import { integrationSyncExecutions, integrationSyncRules } from "../db/integrationSyncSchema.js";
import type { DomainEvent } from "./domainEventBus.js";
import { ZendeskAdapter } from "./integrationConnectionService.js";

const allowedRule = { eventType: "ticket.created", action: "zendesk.create_ticket" } as const;
const PROCESSING_STALE_MS = Number(process.env.INTEGRATION_SYNC_STALE_MS || 10 * 60_000);

export class IntegrationSyncService {
  static async listRules(organizationId: string) {
    return db.select().from(integrationSyncRules).where(eq(integrationSyncRules.organizationId, organizationId)).orderBy(desc(integrationSyncRules.createdAt));
  }

  static async listExecutions(organizationId: string) {
    return db.select().from(integrationSyncExecutions).where(eq(integrationSyncExecutions.organizationId, organizationId)).orderBy(desc(integrationSyncExecutions.createdAt)).limit(100);
  }

  static async createRule(data: { organizationId: string; connectionId: string; eventType: string; action: string; enabled?: boolean }) {
    if (data.eventType !== allowedRule.eventType || data.action !== allowedRule.action) throw new Error("Unsupported integration sync rule");
    const [connection] = await db.select({ id: integrationConnections.id, provider: integrationConnections.provider }).from(integrationConnections)
      .where(and(eq(integrationConnections.organizationId, data.organizationId), eq(integrationConnections.id, data.connectionId))).limit(1);
    if (!connection) throw new Error("Integration connection not found");
    if (connection.provider !== "zendesk") throw new Error("This sync rule requires a Zendesk connection");
    const [rule] = await db.insert(integrationSyncRules).values({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      eventType: data.eventType,
      action: data.action,
      enabled: data.enabled === true,
    }).onConflictDoNothing().returning();
    if (!rule) throw new Error("Integration sync rule already exists");
    return rule;
  }

  static async setEnabled(organizationId: string, id: string, enabled: boolean) {
    const [updated] = await db.update(integrationSyncRules).set({ enabled, updatedAt: new Date() })
      .where(and(eq(integrationSyncRules.organizationId, organizationId), eq(integrationSyncRules.id, id))).returning();
    if (!updated) throw new Error("Integration sync rule not found");
    return updated;
  }

  static async removeRule(organizationId: string, id: string) {
    const [deleted] = await db.delete(integrationSyncRules).where(and(eq(integrationSyncRules.organizationId, organizationId), eq(integrationSyncRules.id, id))).returning({ id: integrationSyncRules.id });
    if (!deleted) throw new Error("Integration sync rule not found");
  }

  static async retryExecution(organizationId: string, id: string) {
    const [execution] = await db.select({ id: integrationSyncExecutions.id, ruleId: integrationSyncExecutions.ruleId, status: integrationSyncExecutions.status })
      .from(integrationSyncExecutions)
      .where(and(eq(integrationSyncExecutions.organizationId, organizationId), eq(integrationSyncExecutions.id, id)))
      .limit(1);
    if (!execution) throw new Error("Integration sync execution not found");
    if (execution.status !== "failed") throw new Error("Only failed sync executions can be retried");

    const [rule] = await db.select({ id: integrationSyncRules.id, enabled: integrationSyncRules.enabled })
      .from(integrationSyncRules)
      .where(and(eq(integrationSyncRules.organizationId, organizationId), eq(integrationSyncRules.id, execution.ruleId)))
      .limit(1);
    if (!rule) throw new Error("Integration sync rule not found");
    if (!rule.enabled) throw new Error("Integration sync rule is disabled");

    const [updated] = await db.update(integrationSyncExecutions).set({ status: "pending", error: null, updatedAt: new Date() })
      .where(and(eq(integrationSyncExecutions.organizationId, organizationId), eq(integrationSyncExecutions.id, id), eq(integrationSyncExecutions.status, "failed")))
      .returning();
    if (!updated) throw new Error("Integration sync execution is no longer retryable");
    return updated;
  }

  static async handleDomainEvent(event: DomainEvent) {
    if (event.type !== allowedRule.eventType) return;
    const entityId = typeof event.payload.id === "string" ? event.payload.id : undefined;
    if (!entityId) return;
    const rules = await db.select().from(integrationSyncRules).where(and(
      eq(integrationSyncRules.organizationId, event.organizationId),
      eq(integrationSyncRules.eventType, event.type),
      eq(integrationSyncRules.action, allowedRule.action),
      eq(integrationSyncRules.enabled, true),
    ));
    for (const rule of rules) {
      await db.insert(integrationSyncExecutions).values({
        organizationId: event.organizationId,
        ruleId: rule.id,
        eventKey: `ticket.created:${entityId}`,
        entityId,
        status: "pending",
      }).onConflictDoNothing({ target: [integrationSyncExecutions.ruleId, integrationSyncExecutions.eventKey] });
    }
  }

  static async processPending(organizationId: string, limit = 25) {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
    const candidates = await db.select().from(integrationSyncExecutions).where(and(
      eq(integrationSyncExecutions.organizationId, organizationId),
      or(eq(integrationSyncExecutions.status, "pending"), and(eq(integrationSyncExecutions.status, "processing"), lt(integrationSyncExecutions.updatedAt, staleBefore))),
    )).orderBy(integrationSyncExecutions.createdAt).limit(limit);

    let succeeded = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const [claimed] = await db.update(integrationSyncExecutions).set({ status: "processing", updatedAt: new Date() }).where(and(
        eq(integrationSyncExecutions.organizationId, organizationId),
        eq(integrationSyncExecutions.id, candidate.id),
        or(eq(integrationSyncExecutions.status, "pending"), and(eq(integrationSyncExecutions.status, "processing"), lt(integrationSyncExecutions.updatedAt, staleBefore))),
      )).returning();
      if (!claimed) continue;

      try {
        const [rule] = await db.select().from(integrationSyncRules).where(and(
          eq(integrationSyncRules.organizationId, organizationId),
          eq(integrationSyncRules.id, claimed.ruleId),
          eq(integrationSyncRules.enabled, true),
        )).limit(1);
        if (!rule) throw new Error("Integration sync rule is disabled or missing");
        if (rule.eventType !== allowedRule.eventType || rule.action !== allowedRule.action) throw new Error("Unsupported integration sync execution");

        const [row] = await db.select({ ticket: tickets, customer: customers }).from(tickets)
          .innerJoin(customers, eq(tickets.customerId, customers.id))
          .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, claimed.entityId))).limit(1);
        if (!row) throw new Error("Local ticket not found");

        const result = await ZendeskAdapter.createTicket(organizationId, {
          subject: row.ticket.subject,
          body: row.ticket.description || `Support ticket #${row.ticket.ticketNumber}`,
          priority: row.ticket.priority,
          requesterEmail: row.customer.email || undefined,
          requesterName: row.customer.name || undefined,
        }, rule.connectionId);
        const rawExternalId = (result as any)?.ticket?.id;
        const externalId = typeof rawExternalId === "number" || typeof rawExternalId === "string" ? String(rawExternalId) : null;
        await db.update(integrationSyncExecutions).set({ status: "succeeded", externalId, error: null, updatedAt: new Date() })
          .where(and(eq(integrationSyncExecutions.organizationId, organizationId), eq(integrationSyncExecutions.id, claimed.id)));
        succeeded += 1;
      } catch (error) {
        await db.update(integrationSyncExecutions).set({ status: "failed", error: (error as Error).message.slice(0, 1000), updatedAt: new Date() })
          .where(and(eq(integrationSyncExecutions.organizationId, organizationId), eq(integrationSyncExecutions.id, claimed.id)));
        failed += 1;
      }
    }
    return { processed: candidates.length, succeeded, failed };
  }

  static async sweepAll(shouldStop?: () => boolean) {
    const tenantRows = await db.select({ id: organizations.id }).from(organizations).limit(10_000);
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    for (const tenant of tenantRows) {
      if (shouldStop?.()) break;
      const result = await withDatabaseTenantContext(async () => {
        setDatabaseTenant(tenant.id);
        return this.processPending(tenant.id);
      });
      processed += result.processed;
      succeeded += result.succeeded;
      failed += result.failed;
    }
    return { processed, succeeded, failed };
  }
}
