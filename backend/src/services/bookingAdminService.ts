import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookingEvents, bookings } from "../db/extendedCustomerExperienceSchema.js";

export class BookingAdminService {
  static async search(data: {
    organizationId: string;
    status?: string;
    from?: Date;
    to?: Date;
    query?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.max(1, Math.min(data.limit ?? 25, 100));
    const offset = Math.max(0, data.offset ?? 0);
    const conditions = [eq(bookings.organizationId, data.organizationId)];
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
    const [items, [countRow]] = await Promise.all([
      db.select().from(bookings).where(where).orderBy(asc(bookings.startsAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(where),
    ]);
    return { items, total: Number(countRow?.count || 0), limit, offset };
  }

  static async history(organizationId: string, bookingId: string) {
    const [booking] = await db.select({ id: bookings.id }).from(bookings)
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).limit(1);
    if (!booking) throw new Error("Booking not found");
    return db.select().from(bookingEvents)
      .where(and(eq(bookingEvents.organizationId, organizationId), eq(bookingEvents.bookingId, bookingId)))
      .orderBy(desc(bookingEvents.createdAt));
  }
}
