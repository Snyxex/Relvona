import { and, desc, eq, gte, lte, sql, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { analyticsEvents, conversations, customers, messageFeedback, tickets } from "../db/schema.js";
import { bookings, meetingTypes, ticketCaseMetadata } from "../db/extendedCustomerExperienceSchema.js";

type Bucket = { day: string; total: number };
function toNumber(value: unknown): number { return Number(value || 0); }
function dailySeries(days: number, now: Date, ticketBuckets: Bucket[], conversationBuckets: Bucket[]) {
  const ticketsMap = new Map(ticketBuckets.map(x => [x.day, toNumber(x.total)]));
  const conversationsMap = new Map(conversationBuckets.map(x => [x.day, toNumber(x.total)]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10);
    return { day, tickets: ticketsMap.get(day) || 0, conversations: conversationsMap.get(day) || 0 };
  });
}

/** Tenant-scoped, bounded data for the employee dashboard. No mock values or unbounded raw lists. */
export class DashboardOverviewService {
  static async get(organizationId: string, days = 30) {
    if (![7, 30, 90].includes(days)) throw new Error("Invalid dashboard range");
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const from = new Date(today - (days - 1) * 86_400_000);
    const previousFrom = new Date(today - (days * 2 - 1) * 86_400_000);
    const ticketDay = sql`to_char(${tickets.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const conversationDay = sql`to_char(${conversations.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const categoryExpression = sql`case when jsonb_typeof(${tickets.tags}) = 'array'
      then coalesce(nullif(${tickets.tags}->>0, ''), 'Ohne Kategorie') else 'Ohne Kategorie' end`;

    const [
      [counts], [previous], statusCounts, categoryCounts,
      ticketBuckets, conversationBuckets, recentTickets, upcoming,
      recentEvents, [feedback], [response], [upcomingCount],
    ] = await Promise.all([
      db.select({
        tickets: sql<number>`(select count(*)::int from tickets where organization_id = ${organizationId} and created_at >= ${from} and created_at <= ${now})`,
        conversations: sql<number>`(select count(*)::int from conversations where organization_id = ${organizationId} and created_at >= ${from} and created_at <= ${now})`,
        appointments: sql<number>`(select count(*)::int from bookings where organization_id = ${organizationId} and created_at >= ${from} and created_at <= ${now})`,
      }).from(sql`(select 1) as dashboard_counts`),
      db.select({
        tickets: sql<number>`(select count(*)::int from tickets where organization_id = ${organizationId} and created_at >= ${previousFrom} and created_at < ${from})`,
        conversations: sql<number>`(select count(*)::int from conversations where organization_id = ${organizationId} and created_at >= ${previousFrom} and created_at < ${from})`,
        appointments: sql<number>`(select count(*)::int from bookings where organization_id = ${organizationId} and created_at >= ${previousFrom} and created_at < ${from})`,
      }).from(sql`(select 1) as previous_counts`),
      db.select({ status: tickets.status, total: sql<number>`count(*)::int` })
        .from(tickets).where(eq(tickets.organizationId, organizationId)).groupBy(tickets.status),
      db.select({ name: sql<string>`${categoryExpression}`, total: sql<number>`count(*)::int` })
        .from(tickets).where(and(eq(tickets.organizationId, organizationId), gte(tickets.createdAt, from)))
        .groupBy(categoryExpression).orderBy(desc(sql`count(*)`)).limit(6),
      db.select({ day: sql<string>`${ticketDay}`, total: sql<number>`count(*)::int` })
        .from(tickets).where(and(eq(tickets.organizationId, organizationId), gte(tickets.createdAt, from)))
        .groupBy(ticketDay),
      db.select({ day: sql<string>`${conversationDay}`, total: sql<number>`count(*)::int` })
        .from(conversations).where(and(eq(conversations.organizationId, organizationId), gte(conversations.createdAt, from)))
        .groupBy(conversationDay),
      db.select({
        id: tickets.id, number: tickets.ticketNumber, subject: tickets.subject,
        status: tickets.status, createdAt: tickets.createdAt, customerName: customers.name,
      }).from(tickets).innerJoin(customers,
        and(eq(customers.id, tickets.customerId), eq(customers.organizationId, organizationId)))
        .where(eq(tickets.organizationId, organizationId))
        .orderBy(desc(tickets.createdAt)).limit(5),
      db.select({
        id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt,
        guestName: bookings.guestName, status: bookings.status, meetingUrl: bookings.meetingUrl,
        title: meetingTypes.name,
      }).from(bookings).innerJoin(meetingTypes, and(eq(meetingTypes.id, bookings.meetingTypeId),
        eq(meetingTypes.organizationId, organizationId)))
        .where(and(eq(bookings.organizationId, organizationId), gte(bookings.startsAt, now),
          eq(bookings.status, "confirmed")))
        .orderBy(asc(bookings.startsAt)).limit(5),
      db.select({ id: analyticsEvents.id, eventType: analyticsEvents.eventType, createdAt: analyticsEvents.createdAt })
        .from(analyticsEvents).where(eq(analyticsEvents.organizationId, organizationId))
        .orderBy(desc(analyticsEvents.createdAt)).limit(5),
      db.select({
        positive: sql<number>`count(*) filter (where ${messageFeedback.rating} = 1)::int`,
        negative: sql<number>`count(*) filter (where ${messageFeedback.rating} = -1)::int`,
      }).from(messageFeedback).where(and(eq(messageFeedback.organizationId, organizationId),
        gte(messageFeedback.createdAt, from))),
      db.select({
        averageMinutes: sql<number | null>`round(avg(extract(epoch from
          (${ticketCaseMetadata.firstRespondedAt} - ${tickets.createdAt})) / 60)
          filter (where ${ticketCaseMetadata.firstRespondedAt} >= ${tickets.createdAt})::numeric, 1)::float`,
      }).from(ticketCaseMetadata).innerJoin(tickets, and(eq(tickets.id, ticketCaseMetadata.ticketId),
        eq(tickets.organizationId, organizationId))).where(and(
          eq(ticketCaseMetadata.organizationId, organizationId), gte(tickets.createdAt, from))),
      db.select({ total: sql<number>`count(*)::int` }).from(bookings)
        .where(and(eq(bookings.organizationId, organizationId), gte(bookings.startsAt, now),
          eq(bookings.status, "confirmed"))),
    ]);

    const statusTotal = statusCounts.reduce((sum, x) => sum + toNumber(x.total), 0);
    const categoryTotal = categoryCounts.reduce((sum, x) => sum + toNumber(x.total), 0);
    const positive = toNumber(feedback?.positive);
    const negative = toNumber(feedback?.negative);
    return {
      generatedAt: now.toISOString(),
      days,
      kpis: {
        tickets: toNumber(counts?.tickets),
        conversations: toNumber(counts?.conversations),
        appointments: toNumber(counts?.appointments),
        upcomingAppointments: toNumber(upcomingCount?.total),
        averageFirstResponseMinutes: response?.averageMinutes == null ? null : Number(response.averageMinutes),
        satisfactionRate: positive + negative ? positive / (positive + negative) : null,
        feedbackCount: positive + negative,
        previous: {
          tickets: toNumber(previous?.tickets), conversations: toNumber(previous?.conversations),
          appointments: toNumber(previous?.appointments),
        },
      },
      volume: dailySeries(days, now, ticketBuckets, conversationBuckets),
      categories: categoryCounts.map(x => ({ name: x.name, total: toNumber(x.total),
        share: categoryTotal ? toNumber(x.total) / categoryTotal : 0 })),
      categoriesTotal: categoryTotal,
      status: statusCounts.map(x => ({ status: x.status, total: toNumber(x.total),
        share: statusTotal ? toNumber(x.total) / statusTotal : 0 })),
      statusTotal,
      recentTickets,
      upcomingAppointments: upcoming,
      activity: recentEvents,
    };
  }
}
