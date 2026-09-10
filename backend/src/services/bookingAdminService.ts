import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookingCalendarSync } from "../db/bookingCalendarSyncSchema.js";
import { bookingEvents, bookings } from "../db/extendedCustomerExperienceSchema.js";

function safeInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

export class BookingAdminService {
  static async search(data: {
    organizationId: string;
    assignedUserId?: string;
    status?: string;
    from?: Date;
    to?: Date;
    query?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = safeInteger(data.limit, 25, 1, 100);
    const offset = safeInteger(data.offset, 0, 0, 1_000_000);
    const conditions = [eq(bookings.organizationId, data.organizationId)];
    if (data.assignedUserId) conditions.push(eq(bookings.assignedUserId, data.assignedUserId));
    if (data.status && data.status !== "all") conditions.push(eq(bookings.status, data.status));
    if (data.from && !Number.isNaN(data.from.getTime())) conditions.push(gte(bookings.startsAt, data.from));
    if (data.to && !Number.isNaN(data.to.getTime())) conditions.push(lte(bookings.startsAt, data.to));
    const query = data.query?.trim();
    if (query) {
      const pattern = `%${query.slice(0, 120)}%`;
      conditions.push(or(
        ilike(bookings.guestEmail, pattern),
        ilike(bookings.guestName, pattern),
        sql`${bookings.id}::text ILIKE ${pattern}`,
      )!);
    }
    const where = and(...conditions)!;
    const [rows, [countRow]] = await Promise.all([
      db.select({
        booking: bookings,
        syncId: bookingCalendarSync.id,
        syncAction: bookingCalendarSync.action,
        syncStatus: bookingCalendarSync.status,
        syncAttempts: bookingCalendarSync.attempts,
        syncLastError: bookingCalendarSync.lastError,
        syncNextAttemptAt: bookingCalendarSync.nextAttemptAt,
      })
        .from(bookings)
        .leftJoin(bookingCalendarSync, and(
          eq(bookingCalendarSync.organizationId, bookings.organizationId),
          eq(bookingCalendarSync.bookingId, bookings.id),
        ))
        .where(where)
        .orderBy(asc(bookings.startsAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(where),
    ]);

    const items = rows.map((row) => ({
      ...row.booking,
      calendarSync: row.syncId ? {
        bookingId: row.booking.id,
        action: row.syncAction,
        status: row.syncStatus,
        attempts: row.syncAttempts ?? 0,
        lastError: row.syncLastError,
        nextAttemptAt: row.syncNextAttemptAt,
      } : {
        bookingId: row.booking.id,
        action: null,
        status: "not_required",
        attempts: 0,
        lastError: null,
        nextAttemptAt: null,
      },
    }));

    return { items, total: Number(countRow?.count || 0), limit, offset };
  }

  static async history(organizationId: string, bookingId: string) {
    return db.select().from(bookingEvents)
      .where(and(eq(bookingEvents.organizationId, organizationId), eq(bookingEvents.bookingId, bookingId)))
      .orderBy(desc(bookingEvents.createdAt));
  }
}
