import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizationMembers, tickets } from "../db/schema.js";
import { ticketCaseMetadata } from "../db/extendedCustomerExperienceSchema.js";
import { supportTeams, ticketRouting } from "../db/teamRoutingSchema.js";
import { SupportCoverageService } from "./supportCoverageService.js";
import { completeDailySeries, estimateSupportDemand, safeRate, utcDay } from "./supportOperationsMath.js";

const CURRENT_STATUSES = ["open", "pending", "in_progress"];
const COMPLETED_STATUSES = ["resolved", "closed"];

function asNumber(value: unknown): number {
  return Number(value || 0);
}

export class SupportOperationsAnalyticsService {
  /** Ticket-created cohorts; SLA evaluation includes only mature deadlines or completed responses. */
  static async report(organizationId: string, requestedDays = 30) {
    if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 365) {
      throw new Error("Invalid report range");
    }
    const days = requestedDays;
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const from = new Date(midnight - (days - 1) * 86_400_000);
    const day14 = new Date(midnight - 13 * 86_400_000);

    const [
      [cohort], [backlog], [last14Arrivals], [last14Resolutions],
      arrivalsByDay, resolvedByDay, teams, routedCounts, roster, memberRoles,
    ] = await Promise.all([
      db.select({
        tickets: sql<number>`count(*)::int`,
        resolved: sql<number>`count(*) filter (where ${tickets.status} in ('resolved','closed'))::int`,
        casesTracked: sql<number>`count(${ticketCaseMetadata.id})::int`,
        firstEvaluated: sql<number>`count(*) filter (where ${ticketCaseMetadata.firstResponseDueAt} is not null
          and (${ticketCaseMetadata.firstRespondedAt} is not null or ${ticketCaseMetadata.firstResponseDueAt} <= ${now}))::int`,
        firstMet: sql<number>`count(*) filter (where ${ticketCaseMetadata.firstResponseDueAt} is not null
          and ${ticketCaseMetadata.firstRespondedAt} is not null
          and ${ticketCaseMetadata.firstRespondedAt} <= ${ticketCaseMetadata.firstResponseDueAt})::int`,
        resolutionEvaluated: sql<number>`count(*) filter (where ${ticketCaseMetadata.resolutionDueAt} is not null
          and (${ticketCaseMetadata.resolvedAt} is not null or ${ticketCaseMetadata.resolutionDueAt} <= ${now}))::int`,
        resolutionMet: sql<number>`count(*) filter (where ${ticketCaseMetadata.resolutionDueAt} is not null
          and ${ticketCaseMetadata.resolvedAt} is not null
          and ${ticketCaseMetadata.resolvedAt} <= ${ticketCaseMetadata.resolutionDueAt})::int`,
        avgFirstMinutes: sql<number | null>`round(avg(extract(epoch from (${ticketCaseMetadata.firstRespondedAt} - ${tickets.createdAt})) / 60)
          filter (where ${ticketCaseMetadata.firstRespondedAt} >= ${tickets.createdAt})::numeric,1)::float`,
        avgResolutionMinutes: sql<number | null>`round(avg(extract(epoch from (${ticketCaseMetadata.resolvedAt} - ${tickets.createdAt})) / 60)
          filter (where ${ticketCaseMetadata.resolvedAt} >= ${tickets.createdAt})::numeric,1)::float`,
      }).from(tickets).leftJoin(ticketCaseMetadata,
        and(eq(ticketCaseMetadata.organizationId, organizationId), eq(ticketCaseMetadata.ticketId, tickets.id)))
        .where(and(eq(tickets.organizationId, organizationId), gte(tickets.createdAt, from))),

      db.select({
        total: sql<number>`count(*)::int`,
        unassigned: sql<number>`count(*) filter (where ${tickets.assignedAgentId} is null)::int`,
        pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending')::int`,
      }).from(tickets).where(and(eq(tickets.organizationId, organizationId), inArray(tickets.status, CURRENT_STATUSES))),

      db.select({ total: sql<number>`count(*)::int` }).from(tickets)
        .where(and(eq(tickets.organizationId, organizationId), gte(tickets.createdAt, day14))),

      db.select({ total: sql<number>`count(*)::int` }).from(ticketCaseMetadata)
        .innerJoin(tickets, and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketCaseMetadata.ticketId)))
        .where(and(eq(ticketCaseMetadata.organizationId, organizationId),
          inArray(tickets.status, COMPLETED_STATUSES), gte(ticketCaseMetadata.resolvedAt, day14))),

      db.select({
        day: sql<string>`to_char(${tickets.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        total: sql<number>`count(*)::int`,
      }).from(tickets).where(and(eq(tickets.organizationId, organizationId), gte(tickets.createdAt, from)))
        .groupBy(sql`to_char(${tickets.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`),

      db.select({
        day: sql<string>`to_char(${ticketCaseMetadata.resolvedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        total: sql<number>`count(*)::int`,
      }).from(ticketCaseMetadata)
        .innerJoin(tickets, and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketCaseMetadata.ticketId)))
        .where(and(eq(ticketCaseMetadata.organizationId, organizationId),
          inArray(tickets.status, COMPLETED_STATUSES), gte(ticketCaseMetadata.resolvedAt, from)))
        .groupBy(sql`to_char(${ticketCaseMetadata.resolvedAt} at time zone 'UTC', 'YYYY-MM-DD')`),

      db.select({ id: supportTeams.id, name: supportTeams.name, enabled: supportTeams.enabled })
        .from(supportTeams).where(eq(supportTeams.organizationId, organizationId))
        .orderBy(supportTeams.name),

      db.select({
        teamId: ticketRouting.teamId,
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending')::int`,
      }).from(ticketRouting)
        .innerJoin(tickets, and(eq(tickets.id, ticketRouting.ticketId), eq(tickets.organizationId, organizationId)))
        .where(and(eq(ticketRouting.organizationId, organizationId), inArray(tickets.status, CURRENT_STATUSES)))
        .groupBy(ticketRouting.teamId),

      SupportCoverageService.roster(organizationId),

      db.select({ userId: organizationMembers.userId, role: organizationMembers.role })
        .from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.status, "active"))),
    ]);

    const [agentCounts] = await Promise.all([
      db.select({
        userId: tickets.assignedAgentId,
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending')::int`,
      }).from(tickets)
        .where(and(eq(tickets.organizationId, organizationId), inArray(tickets.status, CURRENT_STATUSES)))
        .groupBy(tickets.assignedAgentId),
    ]);

    const teamReport = teams.map(team => {
      const agents = roster.filter(p => p.teamIds.includes(team.id));
      const counts = routedCounts.find(row => row.teamId === team.id);
      return {
        id: team.id, name: team.name, enabled: team.enabled,
        members: agents.length,
        availableMembers: agents.filter(p => p.available).length,
        unavailableMembers: agents.filter(p => !p.available).length,
        activeTickets: asNumber(counts?.total),
        pendingTickets: asNumber(counts?.pending),
      };
    });

    const agentReport = roster.map(agent => {
      const counts = agentCounts.find(row => row.userId === agent.userId);
      return {
        userId: agent.userId, name: agent.name, role: memberRoles.find(m => m.userId === agent.userId)?.role || agent.role,
        teamIds: agent.teamIds, presence: agent.status, available: agent.available,
        activeTickets: asNumber(counts?.total), pendingTickets: asNumber(counts?.pending),
        maxOpenTickets: agent.capacity,
      };
    }).sort((a,b) => b.activeTickets - a.activeTickets || a.name.localeCompare(b.name));

    const firstEvaluated = asNumber(cohort?.firstEvaluated);
    const firstMet = asNumber(cohort?.firstMet);
    const resolutionEvaluated = asNumber(cohort?.resolutionEvaluated);
    const resolutionMet = asNumber(cohort?.resolutionMet);
    const currentBacklog = asNumber(backlog?.total);
    const availableAgents = roster.filter(p => p.available).length;

    return {
      generatedAt: now.toISOString(),
      range: { days, from: from.toISOString(), to: now.toISOString(), timezone: "UTC" },
      sla: {
        cohortTickets: asNumber(cohort?.tickets),
        trackedCases: asNumber(cohort?.casesTracked),
        firstResponse: { evaluated: firstEvaluated, met: firstMet, breached: firstEvaluated-firstMet,
          complianceRate: safeRate(firstMet, firstEvaluated), averageMinutes: cohort?.avgFirstMinutes == null ? null : Number(cohort.avgFirstMinutes) },
        resolution: { evaluated: resolutionEvaluated, met: resolutionMet, breached: resolutionEvaluated-resolutionMet,
          complianceRate: safeRate(resolutionMet, resolutionEvaluated), averageMinutes: cohort?.avgResolutionMinutes == null ? null : Number(cohort.avgResolutionMinutes) },
      },
      tickets: {
        openedInRange: asNumber(cohort?.tickets), resolvedFromCohort: asNumber(cohort?.resolved),
        currentBacklog, unassigned: asNumber(backlog?.unassigned), pending: asNumber(backlog?.pending),
      },
      daily: completeDailySeries(days, now, arrivalsByDay, resolvedByDay),
      teams: teamReport,
      agents: agentReport,
      forecast: estimateSupportDemand({
        arrivals14: asNumber(last14Arrivals?.total),
        resolved14: asNumber(last14Resolutions?.total),
        backlog: currentBacklog, availableAgents,
      }),
      definitions: {
        sla: "Tickets, die im gewählten Zeitraum erstellt wurden; bewertet nur Fälle mit Antwort/Lösung oder bereits abgelaufener Frist. Daten ohne SLA-Fall sind ausgeschlossen.",
        teams: "Aktuelle Ticket-Teamzuordnung und aktuelle Personalverfügbarkeit; keine historische Leistung einzelner Teams.",
        agents: "Aktuell zugewiesene offene Tickets; keine personenbezogene historische Leistungsbewertung.",
        daily: "UTC-Tageswerte: neue Tickets nach Erstellungsdatum und gelöste Tickets nach erfasstem Lösungszeitpunkt.",
      },
    };
  }
}
