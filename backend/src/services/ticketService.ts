import { db } from "../db/index.js";
import { tickets, ticketComments, conversations, customers, users } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

export class TicketService {
  // Generate Next Sequential Ticket Number per Org
  private static async getNextTicketNumber(organizationId: string): Promise<number> {
    const [latest] = await db
      .select({ maxNumber: sql<number>`COALESCE(MAX(${tickets.ticketNumber}), 1000)` })
      .from(tickets)
      .where(eq(tickets.organizationId, organizationId));

    return (latest?.maxNumber || 1000) + 1;
  }

  // Create Ticket
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

    return newTicket;
  }

  // List Tickets with Customer and Agent relations
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

    let conditions = [eq(tickets.organizationId, data.organizationId)];

    if (data.status) {
      conditions.push(eq(tickets.status, data.status));
    }
    if (data.priority) {
      conditions.push(eq(tickets.priority, data.priority));
    }
    if (data.assignedAgentId) {
      conditions.push(eq(tickets.assignedAgentId, data.assignedAgentId));
    }

    const whereClause = and(...conditions);

    const result = await db
      .select({
        ticket: tickets,
        customer: customers,
        agent: users,
      })
      .from(tickets)
      .innerJoin(customers, eq(tickets.customerId, customers.id))
      .leftJoin(users, eq(tickets.assignedAgentId, users.id))
      .where(whereClause)
      .orderBy(desc(tickets.createdAt))
      .limit(limit)
      .offset(offset);

    return result.map((r) => ({
      ...r.ticket,
      customer: {
        id: r.customer.id,
        name: r.customer.name,
        email: r.customer.email,
      },
      assignedAgent: r.agent
        ? {
            id: r.agent.id,
            name: r.agent.name,
            email: r.agent.email,
          }
        : null,
    }));
  }

  // Update Ticket
  static async updateTicket(data: {
    organizationId: string;
    ticketId: string;
    status?: string;
    priority?: string;
    assignedAgentId?: string;
    tags?: string[];
  }) {
    const updatePayload: any = { updatedAt: new Date() };

    if (data.status) updatePayload.status = data.status;
    if (data.priority) updatePayload.priority = data.priority;
    if (data.assignedAgentId !== undefined) updatePayload.assignedAgentId = data.assignedAgentId;
    if (data.tags) updatePayload.tags = data.tags;

    const [updated] = await db
      .update(tickets)
      .set(updatePayload)
      .where(and(eq(tickets.id, data.ticketId), eq(tickets.organizationId, data.organizationId)))
      .returning();

    return updated;
  }

  // Add Comment to Ticket
  static async addComment(data: {
    organizationId: string;
    ticketId: string;
    userId: string;
    content: string;
    isInternal?: boolean;
  }) {
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
