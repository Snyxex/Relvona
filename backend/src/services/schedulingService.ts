import { and, asc, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { customers, users } from "../db/schema.js";
import { availabilityRules, bookingEvents, bookings, meetingTypes } from "../db/extendedCustomerExperienceSchema.js";
import { CalendarProviderFactory } from "./calendarProviderFactory.js";

function normalizeSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function validTimezone(value: string) {
  try { Intl.DateTimeFormat("en", { timeZone: value }).format(new Date()); return true; } catch { return false; }
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

export class SchedulingService {
  static async listMeetingTypes(organizationId: string) {
    return db.select().from(meetingTypes).where(eq(meetingTypes.organizationId, organizationId)).orderBy(asc(meetingTypes.name));
  }

  static async createMeetingType(data: {
    organizationId: string; name: string; slug?: string; description?: string; durationMinutes: number;
    bufferBeforeMinutes?: number; bufferAfterMinutes?: number; minimumNoticeMinutes?: number; maxFutureDays?: number; meetingProvider?: string;
  }) {
    const slug = normalizeSlug(data.slug || data.name);
    if (!data.name.trim() || !slug || !Number.isInteger(data.durationMinutes) || data.durationMinutes < 5 || data.durationMinutes > 480) throw new Error("Invalid meeting type");
    const [row] = await db.insert(meetingTypes).values({
      organizationId: data.organizationId, name: data.name.trim().slice(0, 120), slug,
      description: data.description?.trim().slice(0, 2_000), durationMinutes: data.durationMinutes,
      bufferBeforeMinutes: Math.max(0, Math.min(data.bufferBeforeMinutes ?? 0, 240)),
      bufferAfterMinutes: Math.max(0, Math.min(data.bufferAfterMinutes ?? 0, 240)),
      minimumNoticeMinutes: Math.max(0, Math.min(data.minimumNoticeMinutes ?? 60, 10080)),
      maxFutureDays: Math.max(1, Math.min(data.maxFutureDays ?? 60, 365)),
      meetingProvider: data.meetingProvider?.trim().slice(0, 40) || "calendar",
    }).returning();
    return row;
  }

  static async addAvailabilityRule(data: {
    organizationId: string; meetingTypeId?: string; userId?: string; weekday: number; startMinute: number; endMinute: number; timezone: string;
  }) {
    if (!Number.isInteger(data.weekday) || data.weekday < 0 || data.weekday > 6 || !Number.isInteger(data.startMinute) || !Number.isInteger(data.endMinute) || data.startMinute < 0 || data.endMinute > 1440 || data.startMinute >= data.endMinute || !validTimezone(data.timezone)) throw new Error("Invalid availability rule");
    if (data.userId) {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, data.userId)).limit(1);
      if (!user) throw new Error("User not found");
    }
    if (data.meetingTypeId) {
      const [type] = await db.select({ id: meetingTypes.id }).from(meetingTypes).where(and(eq(meetingTypes.organizationId, data.organizationId), eq(meetingTypes.id, data.meetingTypeId))).limit(1);
      if (!type) throw new Error("Meeting type not found");
    }
    const [rule] = await db.insert(availabilityRules).values(data).returning();
    return rule;
  }

  static async listAvailabilityRules(organizationId: string, meetingTypeId?: string) {
    return db.select().from(availabilityRules)
      .where(and(eq(availabilityRules.organizationId, organizationId), meetingTypeId ? eq(availabilityRules.meetingTypeId, meetingTypeId) : undefined))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startMinute));
  }

  static async createBooking(data: {
    organizationId: string; meetingTypeId: string; assignedUserId?: string; customerId?: string; conversationId?: string;
    guestEmail?: string; guestName?: string; startsAt: Date; timezone: string; idempotencyKey?: string; createdBy?: string;
  }) {
    if (!validTimezone(data.timezone) || Number.isNaN(data.startsAt.getTime())) throw new Error("Invalid booking time");
    const [type] = await db.select().from(meetingTypes).where(and(eq(meetingTypes.organizationId, data.organizationId), eq(meetingTypes.id, data.meetingTypeId), eq(meetingTypes.enabled, true))).limit(1);
    if (!type) throw new Error("Meeting type not found");

    const now = new Date();
    if (data.startsAt.getTime() < now.getTime() + type.minimumNoticeMinutes * 60_000) throw new Error("Booking violates minimum notice");
    if (data.startsAt.getTime() > now.getTime() + type.maxFutureDays * 86_400_000) throw new Error("Booking exceeds allowed future range");
    const endsAt = new Date(data.startsAt.getTime() + type.durationMinutes * 60_000);

    if (data.idempotencyKey) {
      const [existing] = await db.select().from(bookings).where(and(eq(bookings.organizationId, data.organizationId), eq(bookings.idempotencyKey, data.idempotencyKey))).limit(1);
      if (existing) return existing;
    }

    if (data.customerId) {
      const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, data.organizationId), eq(customers.id, data.customerId))).limit(1);
      if (!customer) throw new Error("Customer not found");
    }

    const conflictStart = new Date(data.startsAt.getTime() - type.bufferBeforeMinutes * 60_000);
    const conflictEnd = new Date(endsAt.getTime() + type.bufferAfterMinutes * 60_000);
    const [conflict] = await db.select({ id: bookings.id }).from(bookings).where(and(
      eq(bookings.organizationId, data.organizationId), data.assignedUserId ? eq(bookings.assignedUserId, data.assignedUserId) : undefined,
      ne(bookings.status, "cancelled"), lt(bookings.startsAt, conflictEnd), gt(bookings.endsAt, conflictStart),
    )).limit(1);
    if (conflict) throw new Error("Booking conflict");

    let provider = undefined;
    if (data.assignedUserId) {
      provider = await CalendarProviderFactory.forUser(data.organizationId, data.assignedUserId);
      if (provider) {
        const busy = await provider.listBusyIntervals({ from: conflictStart, to: conflictEnd });
        if (busy.some((interval) => overlaps(conflictStart, conflictEnd, interval.start, interval.end))) throw new Error("External calendar conflict");
      }
    }

    const [booking] = await db.insert(bookings).values({
      organizationId: data.organizationId, meetingTypeId: data.meetingTypeId, assignedUserId: data.assignedUserId,
      customerId: data.customerId, conversationId: data.conversationId,
      guestEmail: data.guestEmail?.trim().toLowerCase().slice(0, 254), guestName: data.guestName?.trim().slice(0, 120),
      startsAt: data.startsAt, endsAt, timezone: data.timezone,
      idempotencyKey: data.idempotencyKey?.slice(0, 120), createdBy: data.createdBy?.slice(0, 40) || "system",
    }).returning();

    try {
      if (provider) {
        const event = await provider.createEvent({
          title: type.name,
          description: type.description || undefined,
          start: booking.startsAt,
          end: booking.endsAt,
          timezone: booking.timezone,
          attendeeEmail: booking.guestEmail || undefined,
          attendeeName: booking.guestName || undefined,
        });
        const [synced] = await db.update(bookings).set({ providerEventId: event.externalEventId, meetingUrl: event.meetingUrl, updatedAt: new Date() })
          .where(and(eq(bookings.organizationId, data.organizationId), eq(bookings.id, booking.id))).returning();
        await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "calendar.event_created", actorType: "system", metadata: { providerEventId: event.externalEventId } });
        await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "booking.created", actorType: data.createdBy || "system" });
        return synced || booking;
      }
      await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "booking.created", actorType: data.createdBy || "system" });
      return booking;
    } catch (error) {
      await db.update(bookings).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(bookings.organizationId, data.organizationId), eq(bookings.id, booking.id)));
      await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "calendar.sync_failed", actorType: "system", metadata: { error: (error as Error).message.slice(0, 500) } });
      throw error;
    }
  }

  static async cancelBooking(data: { organizationId: string; bookingId: string; actorType: string; actorUserId?: string }) {
    const [existing] = await db.select().from(bookings).where(and(eq(bookings.organizationId, data.organizationId), eq(bookings.id, data.bookingId))).limit(1);
    if (!existing || existing.status === "cancelled") throw new Error("Booking not found");

    if (existing.providerEventId && existing.assignedUserId) {
      const provider = await CalendarProviderFactory.forUser(data.organizationId, existing.assignedUserId);
      if (provider) await provider.deleteEvent(existing.providerEventId);
    }

    const [booking] = await db.update(bookings).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(bookings.organizationId, data.organizationId), eq(bookings.id, data.bookingId), ne(bookings.status, "cancelled"))).returning();
    if (!booking) throw new Error("Booking not found");
    await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "booking.cancelled", actorType: data.actorType, actorUserId: data.actorUserId });
    return booking;
  }

  static async listBookings(organizationId: string) {
    return db.select().from(bookings).where(eq(bookings.organizationId, organizationId)).orderBy(asc(bookings.startsAt));
  }
}
