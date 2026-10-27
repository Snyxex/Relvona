import { and, eq, gt, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { agentPresence, organizationMembers, tickets, users } from "../db/schema.js";
import { notifications } from "../db/notificationSchema.js";
import { supportTeams, supportTeamMembers, ticketRouting } from "../db/teamRoutingSchema.js";
import { supportAbsences, supportSchedules } from "../db/supportScheduleSchema.js";
import { isAvailableForAutomaticRouting } from "./routingAvailability.js";
import { assertTimezone, isAbsent, isWithinScheduledHours, normalizeShifts } from "./supportSchedulePolicy.js";
import { TeamRoutingService } from "./teamRoutingService.js";

export class SupportCoverageService {
  static async list(organizationId: string) {
    const [schedules, absences] = await Promise.all([
      db.select().from(supportSchedules).where(eq(supportSchedules.organizationId, organizationId)),
      db.select().from(supportAbsences).where(and(
        eq(supportAbsences.organizationId, organizationId), gt(supportAbsences.endsAt, new Date()),
      )).orderBy(supportAbsences.startsAt).limit(500),
    ]);
    return { schedules, absences };
  }

  static async upsertSchedule(organizationId: string, userId: string, data: {
    timezone?: unknown; weeklyShifts?: unknown; backupUserId?: unknown;
    autoRedistribute?: unknown; maxOpenTickets?: unknown;
  }) {
    await TeamRoutingService.assertSupportMember(organizationId, userId);
    const timezone = assertTimezone(data.timezone);
    const weeklyShifts = normalizeShifts(data.weeklyShifts);
    const backupUserId = data.backupUserId === null || data.backupUserId === "" ? null : data.backupUserId;
    if (backupUserId !== null) {
      if (typeof backupUserId !== "string" || backupUserId === userId) throw new Error("Invalid backup employee");
      await TeamRoutingService.assertSupportMember(organizationId, backupUserId);
    }
    if (typeof data.autoRedistribute !== "boolean") throw new Error("Invalid redistribution setting");
    const maxOpenTickets = data.maxOpenTickets === null || data.maxOpenTickets === "" ? null : data.maxOpenTickets;
    if (maxOpenTickets !== null && (!Number.isInteger(maxOpenTickets) || Number(maxOpenTickets) < 1 || Number(maxOpenTickets) > 5000)) {
      throw new Error("Invalid ticket capacity");
    }
    const [schedule] = await db.insert(supportSchedules).values({
      organizationId, userId, timezone, weeklyShifts, backupUserId,
      autoRedistribute: data.autoRedistribute, maxOpenTickets: maxOpenTickets as number | null,
    }).onConflictDoUpdate({
      target: [supportSchedules.organizationId, supportSchedules.userId],
      set: { timezone, weeklyShifts, backupUserId, autoRedistribute: data.autoRedistribute, maxOpenTickets: maxOpenTickets as number | null, updatedAt: new Date() },
    }).returning();
    return schedule;
  }

  static async createAbsence(organizationId: string, input: {
    userId?: unknown; startsAt?: unknown; endsAt?: unknown; reason?: unknown; note?: unknown;
  }) {
    if (typeof input.userId !== "string") throw new Error("Invalid employee");
    await TeamRoutingService.assertSupportMember(organizationId, input.userId);
    if (typeof input.startsAt !== "string" || typeof input.endsAt !== "string") throw new Error("Invalid absence dates");
    const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())
      || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000) throw new Error("Invalid absence dates");
    const reason = input.reason === undefined ? "vacation" : input.reason;
    if (!["vacation", "sick", "other"].includes(reason as string)) throw new Error("Invalid absence reason");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : null;
    const [overlap] = await db.select({ id: supportAbsences.id }).from(supportAbsences).where(and(
      eq(supportAbsences.organizationId, organizationId), eq(supportAbsences.userId, input.userId),
      lt(supportAbsences.startsAt, endsAt), gt(supportAbsences.endsAt, startsAt),
    )).limit(1);
    if (overlap) throw new Error("Absence overlaps an existing period");
    const [row] = await db.insert(supportAbsences).values({
      organizationId, userId: input.userId, startsAt, endsAt, reason: reason as string, note,
    }).returning();
    return row;
  }

  static async deleteAbsence(organizationId: string, id: string) {
    const [deleted] = await db.delete(supportAbsences).where(and(
      eq(supportAbsences.organizationId, organizationId), eq(supportAbsences.id, id),
    )).returning({ id: supportAbsences.id });
    return Boolean(deleted);
  }

  static async roster(organizationId: string) {
    const now = new Date();
    const [members, schedules, absences, presence, workload, teamMemberships] = await Promise.all([
      db.select({ userId: organizationMembers.userId, name: users.name, role: organizationMembers.role }).from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "active"), eq(users.status, "active"),
          inArray(organizationMembers.role, ["owner", "admin", "agent"]))),
      db.select().from(supportSchedules).where(eq(supportSchedules.organizationId, organizationId)),
      db.select().from(supportAbsences).where(and(eq(supportAbsences.organizationId, organizationId),
        lte(supportAbsences.startsAt, now), gt(supportAbsences.endsAt, now))),
      db.select().from(agentPresence).where(eq(agentPresence.organizationId, organizationId)),
      db.select({ userId: tickets.assignedAgentId, count: sql<number>`count(*)::int` }).from(tickets)
        .where(and(eq(tickets.organizationId, organizationId), inArray(tickets.status, ["open", "in_progress"])))
        .groupBy(tickets.assignedAgentId),
      db.select().from(supportTeamMembers).where(eq(supportTeamMembers.organizationId, organizationId)),
    ]);
    return members.map(member => {
      const schedule = schedules.find(s => s.userId === member.userId);
      const currentAbsences = absences.filter(a => a.userId === member.userId);
      const currentPresence = presence.find(p => p.userId === member.userId);
      const openTickets = workload.find(w => w.userId === member.userId)?.count || 0;
      const absent = isAbsent(currentAbsences, now);
      const onShift = isWithinScheduledHours(schedule, now);
      const online = isAvailableForAutomaticRouting(currentPresence?.status, currentPresence?.updatedAt, now);
      const withinCapacity = schedule?.maxOpenTickets == null || openTickets < schedule.maxOpenTickets;
      return { ...member, teamIds: teamMemberships.filter(t => t.userId === member.userId).map(t => t.teamId),
        openTickets, capacity: schedule?.maxOpenTickets ?? null,
        status: absent ? "absent" : !onShift ? "off_shift" : !online ? "offline" : !withinCapacity ? "at_capacity" : "available",
        available: !absent && onShift && online && withinCapacity,
      };
    });
  }

  private static async coverageWarning(organizationId: string, ticket: { id: string; ticketNumber: number }, reason: string) {
    const admins = await db.select({ userId: organizationMembers.userId }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "active"),
      inArray(organizationMembers.role, ["owner", "admin"]),
    ));
    const [routing] = await db.select({ leadUserId: supportTeams.leadUserId }).from(ticketRouting)
      .innerJoin(supportTeams, and(eq(ticketRouting.teamId, supportTeams.id), eq(supportTeams.organizationId, organizationId)))
      .where(and(eq(ticketRouting.organizationId, organizationId), eq(ticketRouting.ticketId, ticket.id))).limit(1);
    const recipients = [...new Set([...admins.map(a => a.userId), routing?.leadUserId].filter((v): v is string => Boolean(v)))];
    for (const recipientUserId of recipients) {
      await db.insert(notifications).values({
        organizationId, recipientUserId, type: "ticket.coverage_missing", severity: "warning",
        title: `Ticket #${ticket.ticketNumber} ohne Vertretung`,
        message: reason === "absent" ? "Zuständiger Mitarbeiter ist abwesend und keine verfügbare Vertretung ist vorhanden." : "Für das Ticket ist aktuell kein verfügbares Teammitglied vorhanden.",
        resourceType: "ticket", resourceId: ticket.id,
        dedupeKey: `coverage:${ticket.id}:${reason}:${new Date().toISOString().slice(0,10)}`,
      }).onConflictDoNothing({ target: [notifications.organizationId, notifications.recipientUserId, notifications.dedupeKey] });
    }
  }

  /** Existing tickets are transferred only on explicitly configured absences or off-shift schedules. */
  static async sweepOrganization(organizationId: string) {
    const now = new Date();
    const [schedules, absences] = await Promise.all([
      db.select().from(supportSchedules).where(eq(supportSchedules.organizationId, organizationId)),
      db.select().from(supportAbsences).where(and(eq(supportAbsences.organizationId, organizationId),
        lte(supportAbsences.startsAt, now), gt(supportAbsences.endsAt, now))),
    ]);
    let redistributed = 0, warnings = 0, assigned = 0;
    const owners = new Set([...schedules.filter(s => s.autoRedistribute).map(s => s.userId), ...absences.map(a => a.userId)]);
    for (const userId of owners) {
      const schedule = schedules.find(s => s.userId === userId);
      if (schedule && !schedule.autoRedistribute) continue;
      const absent = isAbsent(absences.filter(a => a.userId === userId), now);
      if (!absent && (!schedule || isWithinScheduledHours(schedule, now))) continue;
      const existing = await db.select().from(tickets).where(and(
        eq(tickets.organizationId, organizationId), eq(tickets.assignedAgentId, userId),
        inArray(tickets.status, ["open", "in_progress"]),
      )).orderBy(tickets.createdAt).limit(100);
      for (const ticket of existing) {
        const result = await TeamRoutingService.routeTicket(organizationId, ticket.id, undefined, {
          expectedAssignedUserId: userId, preferredBackupUserId: schedule?.backupUserId || undefined,
        });
        if (result.assigned) redistributed++;
        else if ("reason" in result && result.reason === "no_available_team_member") { await this.coverageWarning(organizationId, ticket, absent ? "absent" : "off_shift"); warnings++; }
      }
    }
    // Tickets that arrived while no one was online can be assigned once coverage becomes available.
    const unassigned = await db.select().from(tickets).where(and(
      eq(tickets.organizationId, organizationId), isNull(tickets.assignedAgentId),
      inArray(tickets.status, ["open", "in_progress"]),
    )).orderBy(tickets.createdAt).limit(100);
    for (const ticket of unassigned) {
      const result = await TeamRoutingService.routeTicket(organizationId, ticket.id);
      if (result.assigned) assigned++;
      else if ("reason" in result && result.reason === "no_available_team_member") { await this.coverageWarning(organizationId, ticket, "unassigned"); warnings++; }
    }
    return { redistributed, assigned, warnings };
  }
}
