import { db } from "../db/index.js";
import { tickets, ticketComments, conversations, customers, users, organizationMembers } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { GitHubIssueService } from "./githubIssueService.js";
import { domainEventBus } from "./domainEventBus.js";

export class TicketService {
  private static async assertAssignableAgent(organizationId: string, userId: string | undefined) {
    if (!userId) return;
    const [membership] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
      .limit(1);
    if (!membership || !["owner", "admin", "agent"].includes(membership.role)) throw new Error("Assigned agent is not a support member");
  }

  private static async emitCreated(ticket: typeof tickets.$inferSelect) {
    await domainEventBus.emit({ type: "ticket.created", organizationId: ticket.organizationId, conversationId: ticket.conversationId || undefined, payload: ticket });
  }

  private static async emitUpdated(ticket: typeof tickets.$inferSelect, changedFields: string[]) {
    await domainEventBus.emit({
      type: "ticket.updated",
      organizationId: ticket.organizationId,
      conversationId: ticket.conversationId || undefined,
      payload: { ...ticket, changedFields },
    });
  }

  private static async getNextTicketNumber(organizationId: string): Promise<number> {
    const [latest] = await db
      .select({ maxNumber: sql<number>`COALESCE(MAX(${tickets.ticketNumber}), 1000)` })
      .from(tickets)
      .where(eq(tickets.organizationId, organizationId));

    return (latest?.maxNumber || 1000) + 1;
  }

  static async createTicket(data: {
    organizationId: string;
    customerId: string;
    conversationId?: string;
    subject: string;
    description?: string;
    priority?: "low" | "normal" | "high" | "urgent";
    assignedAgentId?: string;
    tags?: string[];
  }) {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, data.customerId), eq(customers.organizationId, data.organizationId)))
      .limit(1);
    if (!customer) throw new Error("Customer not found");
    await this.assertAssignableAgent(data.organizationId, data.assignedAgentId);

    if (data.conversationId) {
      const [conversation] = await db
        .select({ customerId: conversations.customerId })
        .from(conversations)
        .where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, data.organizationId)))
        .limit(1);
      if (!conversation || conversation.customerId !== data.customerId) throw new Error("Conversation not found");
    }

    const ticketNumber = await this.getNextTicketNumber(data.organizationId);
    const [newTicket] = await db
      .insert(tickets)
      .values({
        ticketNumber,
        organizationId: data.organizationId,
        customerId: data.customerId,
        conversationId: data.conversationId,
        subject: data.subject,
        description: data.description,
        priority: data.priority || "normal",
        status: "open",
        assignedAgentId: data.assignedAgentId,
        tags: data.tags || [],
      })
      .returning();

    await this.emitCreated(newTicket);
    return newTicket;
  }

  static async getOrCreateEscalationTicket(data: {
    organizationId: string;
    customerId: string;
    conversationId: string;
    subject: string;
    description: string;
    priority?: "low" | "normal" | "high" | "urgent";
    tags?: string[];
  }) {
    const [existing] = await db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.organizationId, data.organizationId),
          eq(tickets.conversationId, data.conversationId),
          eq(tickets.source, "ai_escalation")
        )
      )
      .orderBy(desc(tickets.createdAt))
      .limit(1);

    if (existing && existing.status !== "resolved" && existing.status !== "closed") {
      return { ticket: existing, created: false };
    }

    const ticketNumber = await this.getNextTicketNumber(data.organizationId);
    const [created] = await db
      .insert(tickets)
      .values({
        ticketNumber,
        organizationId: data.organizationId,
        customerId: data.customerId,
        conversationId: data.conversationId,
        subject: data.subject,
        description: data.description,
        priority: data.priority || "normal",
        status: "open",
        source: "ai_escalation",
        tags: data.tags || [],
      })
      .onConflictDoNothing({
        target: [tickets.organizationId, tickets.conversationId],
        where: sql`${tickets.source} = 'ai_escalation' AND ${tickets.conversationId} IS NOT NULL AND ${tickets.status} NOT IN ('resolved', 'closed')`,
      })
      .returning();

    if (created) {
      await GitHubIssueService.createForEscalation(created);
      const [synced] = await db.select().from(tickets).where(eq(tickets.id, created.id)).limit(1);
      const finalTicket = synced || created;
      await this.emitCreated(finalTicket);
      return { ticket: finalTicket, created: true };
    }

    const [concurrentTicket] = await db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.organizationId, data.organizationId),
          eq(tickets.conversationId, data.conversationId),
          eq(tickets.source, "ai_escalation")
        )
      )
      .orderBy(desc(tickets.createdAt))
      .limit(1);
    if (!concurrentTicket) throw new Error("Unable to create escalation ticket");
    return { ticket: concurrentTicket, created: false };
  }

  static async listTickets(data: {
    organizationId: string;
    status?: string;
    priority?: string;
    assignedAgentId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = data.page || 1;
    const limit = data.limit || 20;
    const offset = (page - 1) * limit;
    const conditions = [eq(tickets.organizationId, data.organizationId)];

    if (data.status) conditions.push(eq(tickets.status, data.status));
    if (data.priority) conditions.push(eq(tickets.priority, data.priority));
    if (data.assignedAgentId) conditions.push(eq(tickets.assignedAgentId, data.assignedAgentId));

    const result = await db
      .select({ ticket: tickets, customer: customers, agent: users })
      .from(tickets)
      .innerJoin(customers, eq(tickets.customerId, customers.id))
      .leftJoin(users, eq(tickets.assignedAgentId, users.id))
      .where(and(...conditions))
      .orderBy(desc(tickets.createdAt))
      .limit(limit)
      .offset(offset);

    return result.map((r) => ({
      ...r.ticket,
      customer: { id: r.customer.id, name: r.customer.name, email: r.customer.email },
      assignedAgent: r.agent ? { id: r.agent.id, name: r.agent.name, email: r.agent.email } : null,
    }));
  }

  static async updateTicket(data: {
    organizationId: string;
    ticketId: string;
    status?: string;
    priority?: string;
    assignedAgentId?: string;
    tags?: string[];
  }) {
    const validStatuses = ["open", "pending", "in_progress", "resolved", "closed"];
    const validPriorities = ["low", "normal", "high", "urgent"];
    if (data.status && !validStatuses.includes(data.status)) throw new Error("Invalid ticket status");
    if (data.priority && !validPriorities.includes(data.priority)) throw new Error("Invalid ticket priority");
    const updatePayload: any = { updatedAt: new Date() };
    const changedFields: string[] = [];

    if (data.status !== undefined) { updatePayload.status = data.status; changedFields.push("status"); }
    if (data.priority !== undefined) { updatePayload.priority = data.priority; changedFields.push("priority"); }
    if (data.assignedAgentId !== undefined) { updatePayload.assignedAgentId = data.assignedAgentId; changedFields.push("assignedAgentId"); }
    if (data.tags !== undefined) { updatePayload.tags = data.tags; changedFields.push("tags"); }

    await this.assertAssignableAgent(data.organizationId, data.assignedAgentId);
    const [updated] = await db
      .update(tickets)
      .set(updatePayload)
      .where(and(eq(tickets.id, data.ticketId), eq(tickets.organizationId, data.organizationId)))
      .returning();

    if (updated) await this.emitUpdated(updated, changedFields);
    return updated;
  }

  static async addComment(data: {
    organizationId: string;
    ticketId: string;
    userId: string;
    content: string;
    isInternal?: boolean;
  }) {
    const [ticket] = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.id, data.ticketId), eq(tickets.organizationId, data.organizationId)))
      .limit(1);
    if (!ticket) throw new Error("Ticket not found");

    const [comment] = await db
      .insert(ticketComments)
      .values({
        ticketId: data.ticketId,
        organizationId: data.organizationId,
        userId: data.userId,
        content: data.content,
        isInternal: data.isInternal ?? true,
      })
      .returning();

    return comment;
  }
}
