import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { tickets } from "../db/schema.js";
import { ticketCaseEvents, ticketCaseMetadata, ticketSlaPolicies } from "../db/extendedCustomerExperienceSchema.js";

const defaultSla = {
  low: { firstResponseMinutes: 480, resolutionMinutes: 4320 },
  normal: { firstResponseMinutes: 240, resolutionMinutes: 1440 },
  high: { firstResponseMinutes: 60, resolutionMinutes: 480 },
  urgent: { firstResponseMinutes: 15, resolutionMinutes: 120 },
} as const;

type TicketPriority = keyof typeof defaultSla;

function normalizedPriority(value: string): TicketPriority {
  return value in defaultSla ? value as TicketPriority : "normal";
}

export class TicketCaseService {
  static async policyFor(organizationId: string, priority: string) {
    const normalized = normalizedPriority(priority);
    const [policy] = await db.select().from(ticketSlaPolicies)
      .where(and(eq(ticketSlaPolicies.organizationId, organizationId), eq(ticketSlaPolicies.priority, normalized), eq(ticketSlaPolicies.enabled, true)))
      .limit(1);
    return policy || { organizationId, priority: normalized, ...defaultSla[normalized], enabled: true };
  }

  static async ensureCase(organizationId: string, ticketId: string) {
    const [ticket] = await db.select().from(tickets)
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId))).limit(1);
    if (!ticket) throw new Error("Ticket not found");

    const [existing] = await db.select().from(ticketCaseMetadata)
      .where(and(eq(ticketCaseMetadata.organizationId, organizationId), eq(ticketCaseMetadata.ticketId, ticketId))).limit(1);
    if (existing) return existing;

    const policy = await this.policyFor(organizationId, ticket.priority);
    const created = ticket.createdAt || new Date();
    const [caseRow] = await db.insert(ticketCaseMetadata).values({
      organizationId,
      ticketId,
      firstResponseDueAt: new Date(created.getTime() + policy.firstResponseMinutes * 60_000),
      resolutionDueAt: new Date(created.getTime() + policy.resolutionMinutes * 60_000),
    }).onConflictDoNothing({ target: [ticketCaseMetadata.organizationId, ticketCaseMetadata.ticketId] }).returning();

    if (caseRow) {
      await db.insert(ticketCaseEvents).values({ organizationId, ticketId, type: "case.created", metadata: { priority: ticket.priority } });
      return caseRow;
    }
    const [concurrent] = await db.select().from(ticketCaseMetadata)
      .where(and(eq(ticketCaseMetadata.organizationId, organizationId), eq(ticketCaseMetadata.ticketId, ticketId))).limit(1);
    if (!concurrent) throw new Error("Unable to initialize ticket case");
    return concurrent;
  }

  static async recordTransition(data: {
    organizationId: string;
    ticketId: string;
    actorUserId?: string;
    type: string;
    fromValue?: string | null;
    toValue?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.ensureCase(data.organizationId, data.ticketId);
    return db.insert(ticketCaseEvents).values({
      organizationId: data.organizationId,
      ticketId: data.ticketId,
      actorUserId: data.actorUserId,
      type: data.type,
      fromValue: data.fromValue,
      toValue: data.toValue,
      metadata: data.metadata || {},
    }).returning();
  }

  static async markFirstResponse(data: { organizationId: string; ticketId: string; actorUserId?: string }) {
    const caseRow = await this.ensureCase(data.organizationId, data.ticketId);
    if (caseRow.firstRespondedAt) return caseRow;
    const now = new Date();
    const [updated] = await db.update(ticketCaseMetadata).set({ firstRespondedAt: now, updatedAt: now })
      .where(and(eq(ticketCaseMetadata.organizationId, data.organizationId), eq(ticketCaseMetadata.ticketId, data.ticketId), isNull(ticketCaseMetadata.firstRespondedAt))).returning();
    if (updated) await this.recordTransition({ organizationId: data.organizationId, ticketId: data.ticketId, actorUserId: data.actorUserId, type: "sla.first_response", toValue: now.toISOString() });
    return updated || caseRow;
  }

  static async syncTicketUpdate(data: {
    organizationId: string;
    ticketId: string;
    actorUserId?: string;
    previous: { status: string; priority: string; assignedAgentId: string | null };
    current: { status: string; priority: string; assignedAgentId: string | null };
  }) {
    const now = new Date();
    let caseRow = await this.ensureCase(data.organizationId, data.ticketId);

    if (data.previous.priority !== data.current.priority) {
      const policy = await this.policyFor(data.organizationId, data.current.priority);
      const [ticket] = await db.select({ createdAt: tickets.createdAt }).from(tickets)
        .where(and(eq(tickets.organizationId, data.organizationId), eq(tickets.id, data.ticketId))).limit(1);
      const started = ticket?.createdAt || now;
      [caseRow] = await db.update(ticketCaseMetadata).set({
        firstResponseDueAt: caseRow.firstRespondedAt ? caseRow.firstResponseDueAt : new Date(started.getTime() + policy.firstResponseMinutes * 60_000),
        resolutionDueAt: new Date(started.getTime() + policy.resolutionMinutes * 60_000),
        updatedAt: now,
      }).where(and(eq(ticketCaseMetadata.organizationId, data.organizationId), eq(ticketCaseMetadata.ticketId, data.ticketId))).returning();
      await this.recordTransition({ organizationId: data.organizationId, ticketId: data.ticketId, actorUserId: data.actorUserId, type: "priority.changed", fromValue: data.previous.priority, toValue: data.current.priority });
    }

    if (data.previous.status !== data.current.status) {
      const patch: Record<string, unknown> = { updatedAt: now };
      if (data.current.status === "resolved" || data.current.status === "closed") patch.resolvedAt = now;
      if (data.current.status === "pending") patch.waitingSince = now;
      if (data.previous.status === "pending" && data.current.status !== "pending") patch.waitingSince = null;
      await db.update(ticketCaseMetadata).set(patch).where(and(eq(ticketCaseMetadata.organizationId, data.organizationId), eq(ticketCaseMetadata.ticketId, data.ticketId)));
      await this.recordTransition({ organizationId: data.organizationId, ticketId: data.ticketId, actorUserId: data.actorUserId, type: "status.changed", fromValue: data.previous.status, toValue: data.current.status });
    }

    if (data.previous.assignedAgentId !== data.current.assignedAgentId) {
      await this.recordTransition({ organizationId: data.organizationId, ticketId: data.ticketId, actorUserId: data.actorUserId, type: "assignment.changed", fromValue: data.previous.assignedAgentId, toValue: data.current.assignedAgentId });
    }
  }

  static async detail(organizationId: string, ticketId: string) {
    const [ticket] = await db.select().from(tickets).where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId))).limit(1);
    if (!ticket) throw new Error("Ticket not found");
    const caseRow = await this.ensureCase(organizationId, ticketId);
    const events = await db.select().from(ticketCaseEvents)
      .where(and(eq(ticketCaseEvents.organizationId, organizationId), eq(ticketCaseEvents.ticketId, ticketId)))
      .orderBy(asc(ticketCaseEvents.createdAt));
    const now = new Date();
    return {
      ticket,
      case: caseRow,
      sla: {
        firstResponseBreached: Boolean(!caseRow.firstRespondedAt && caseRow.firstResponseDueAt && caseRow.firstResponseDueAt < now),
        resolutionBreached: Boolean(!caseRow.resolvedAt && caseRow.resolutionDueAt && caseRow.resolutionDueAt < now),
      },
      events,
    };
  }

  static async listPolicies(organizationId: string) {
    return db.select().from(ticketSlaPolicies).where(eq(ticketSlaPolicies.organizationId, organizationId)).orderBy(asc(ticketSlaPolicies.priority));
  }

  static async upsertPolicy(data: { organizationId: string; priority: string; firstResponseMinutes: number; resolutionMinutes: number; enabled: boolean }) {
    const priority = normalizedPriority(data.priority);
    if (!Number.isInteger(data.firstResponseMinutes) || data.firstResponseMinutes < 1 || !Number.isInteger(data.resolutionMinutes) || data.resolutionMinutes < 1) throw new Error("Invalid SLA durations");
    const [policy] = await db.insert(ticketSlaPolicies).values({ ...data, priority })
      .onConflictDoUpdate({ target: [ticketSlaPolicies.organizationId, ticketSlaPolicies.priority], set: { firstResponseMinutes: data.firstResponseMinutes, resolutionMinutes: data.resolutionMinutes, enabled: data.enabled, updatedAt: new Date() } }).returning();
    return policy;
  }
}
