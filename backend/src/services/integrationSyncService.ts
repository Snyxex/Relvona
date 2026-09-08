import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { customers, tickets } from "../db/schema.js";
import { integrationConnections } from "../db/integrationConnectionSchema.js";
import { integrationSyncExecutions, integrationSyncRules } from "../db/integrationSyncSchema.js";
import type { DomainEvent } from "./domainEventBus.js";
import { ZendeskAdapter } from "./integrationConnectionService.js";

const allowedRule = { eventType: "ticket.created", action: "zendesk.create_ticket" } as const;

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
    await Promise.allSettled(rules.map((rule) => this.executeTicketCreatedRule(rule.id, event.organizationId, rule.connectionId, entityId)));
  }

  private static async executeTicketCreatedRule(ruleId: string, organizationId: string, connectionId: string, ticketId: string) {
    const eventKey = `ticket.created:${ticketId}`;
    const [execution] = await db.insert(integrationSyncExecutions).values({
      organizationId,
      ruleId,
      eventKey,
      entityId: ticketId,
      status: "pending",
    }).onConflictDoNothing({ target: [integrationSyncExecutions.ruleId, integrationSyncExecutions.eventKey] }).returning();
    if (!execution) return;

    try {
      const [row] = await db.select({ ticket: tickets, customer: customers }).from(tickets)
        .innerJoin(customers, eq(tickets.customerId, customers.id))
        .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId))).limit(1);
      if (!row) throw new Error("Local ticket not found");
      const result = await ZendeskAdapter.createTicket(organizationId, {
        subject: row.ticket.subject,
        body: row.ticket.description || `Support ticket #${row.ticket.ticketNumber}`,
        priority: row.ticket.priority,
        requesterEmail: row.customer.email || undefined,
        requesterName: row.customer.name || undefined,
      }, connectionId);
      const externalId = typeof (result as any)?.ticket?.id === "number" || typeof (result as any)?.ticket?.id === "string" ? String((result as any).ticket.id) : null;
      await db.update(integrationSyncExecutions).set({ status: "succeeded", externalId, error: null, updatedAt: new Date() })
        .where(and(eq(integrationSyncExecutions.organizationId, organizationId), eq(integrationSyncExecutions.id, execution.id)));
    } catch (error) {
      await db.update(integrationSyncExecutions).set({ status: "failed", error: (error as Error).message.slice(0, 1000), updatedAt: new Date() })
        .where(and(eq(integrationSyncExecutions.organizationId, organizationId), eq(integrationSyncExecutions.id, execution.id)));
    }
  }
}
