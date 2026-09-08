import { and, asc, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { customers, users } from "../db/schema.js";
import { availabilityRules, bookingEvents, bookings, meetingTypes } from "../db/extendedCustomerExperienceSchema.js";
import { CalendarProviderFactory } from "./calendarProviderFactory.js";
import { SchedulingMutationLockService } from "./schedulingMutationLockService.js";
import { BookingCalendarSyncService, type BookingCalendarSyncAction } from "./bookingCalendarSyncService.js";
import { domainEventBus } from "./domainEventBus.js";

function normalizeSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function validTimezone(value: string) {
  try { Intl.DateTimeFormat("en", { timeZone: value }).format(new Date()); return true; } catch { return false; }
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

function localWeekdayMinute(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = formatter.formatToParts(date);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value || "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[weekdayName] ?? 0;
  return { weekday, minuteOfDay: hour * 60 + minute };
}

function sameInterval(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return Math.abs(aStart.getTime() - bStart.getTime()) < 60_000 && Math.abs(aEnd.getTime() - bEnd.getTime()) < 60_000;
}

type BookingRow = typeof bookings.$inferSelect;

async function emitBookingEvent(type: "booking.created" | "booking.rescheduled" | "booking.cancelled", booking: BookingRow) {
  await domainEventBus.emit({
    type,
    organizationId: booking.organizationId,
    conversationId: booking.conversationId || undefined,
    payload: {
      bookingId: booking.id,
      meetingTypeId: booking.meetingTypeId,
      assignedUserId: booking.assignedUserId || undefined,
      status: booking.status,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      timezone: booking.timezone,
    },
  });
}

async function attemptCalendarSync(data: {
  organizationId: string;
  bookingId: string;
  action: BookingCalendarSyncAction;
}) {
  await BookingCalendarSyncService.enqueue(data.organizationId, data.bookingId, data.action);
  const result = await BookingCalendarSyncService.processOne(data.organizationId, data.bookingId);
  if (result.processed && result.status !== "synced") {
    await db.insert(bookingEvents).values({
      organizationId: data.organizationId,
      bookingId: data.bookingId,
      type: "calendar.sync_failed",
      actorType: "system",
      metadata: { action: data.action, error: result.error || "Calendar sync pending retry" },
    });
  } else if (result.processed && result.status === "synced") {
    await db.insert(bookingEvents).values({
      organizationId: data.organizationId,
      bookingId: data.bookingId,
      type: "calendar.synced",
      actorType: "system",
      metadata: { action: data.action },
    });
  }
  return result;
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

  static async findAvailableSlots(data: { organizationId: string; meetingTypeId: string; assignedUserId?: string; from: Date; to: Date; limit?: number; stepMinutes?: number }) {
    if (Number.isNaN(data.from.getTime()) || Number.isNaN(data.to.getTime()) || data.to <= data.from) throw new Error("Invalid slot range");
    const [type] = await db.select().from(meetingTypes).where(and(eq(meetingTypes.organizationId, data.organizationId), eq(meetingTypes.id, data.meetingTypeId), eq(meetingTypes.enabled, true))).limit(1);
    if (!type) throw new Error("Meeting type not found");
    const now = new Date();
    const earliest = new Date(Math.max(data.from.getTime(), now.getTime() + type.minimumNoticeMinutes * 60_000));
    const latest = new Date(Math.min(data.to.getTime(), now.getTime() + type.maxFutureDays * 86_400_000));
    if (latest <= earliest) return [];

    const rules = (await db.select().from(availabilityRules).where(and(eq(availabilityRules.organizationId, data.organizationId), eq(availabilityRules.enabled, true))))
      .filter((rule) => (!rule.meetingTypeId || rule.meetingTypeId === data.meetingTypeId) && (!rule.userId || rule.userId === data.assignedUserId));
    if (!rules.length) return [];

    const internal = await db.select().from(bookings).where(and(
      eq(bookings.organizationId, data.organizationId),
      data.assignedUserId ? eq(bookings.assignedUserId, data.assignedUserId) : undefined,
      ne(bookings.status, "cancelled"),
      lt(bookings.startsAt, latest),
      gt(bookings.endsAt, earliest),
    ));
    const provider = data.assignedUserId ? await CalendarProviderFactory.forUser(data.organizationId, data.assignedUserId) : undefined;
    const external = provider ? await provider.listBusyIntervals({ from: earliest, to: latest }) : [];

    const step = Math.max(5, Math.min(data.stepMinutes || 15, 60));
    const durationMs = type.durationMinutes * 60_000;
    let cursorMs = Math.ceil(earliest.getTime() / (step * 60_000)) * step * 60_000;
    const slots: Array<{ startsAt: Date; endsAt: Date; timezone: string }> = [];
    const limit = Math.max(1, Math.min(data.limit || 12, 50));

    while (cursorMs + durationMs <= latest.getTime() && slots.length < limit) {
      const start = new Date(cursorMs);
      const end = new Date(cursorMs + durationMs);
      const matchingRule = rules.find((rule) => {
        const startLocal = localWeekdayMinute(start, rule.timezone);
        const endLocal = localWeekdayMinute(end, rule.timezone);
        return startLocal.weekday === rule.weekday && endLocal.weekday === rule.weekday && startLocal.minuteOfDay >= rule.startMinute && endLocal.minuteOfDay <= rule.endMinute;
      });
      if (matchingRule) {
        const bufferedStart = new Date(start.getTime() - type.bufferBeforeMinutes * 60_000);
        const bufferedEnd = new Date(end.getTime() + type.bufferAfterMinutes * 60_000);
        const internalConflict = internal.some((item) => overlaps(bufferedStart, bufferedEnd, item.startsAt, item.endsAt));
        const externalConflict = external.some((item) => overlaps(bufferedStart, bufferedEnd, item.start, item.end));
        if (!internalConflict && !externalConflict) slots.push({ startsAt: start, endsAt: end, timezone: matchingRule.timezone });
      }
      cursorMs += step * 60_000;
    }
    return slots;
  }

  static async createBooking(data: {
    organizationId: string; meetingTypeId: string; assignedUserId?: string; customerId?: string; conversationId?: string;
    guestEmail?: string; guestName?: string; startsAt: Date; timezone: string; idempotencyKey?: string; createdBy?: string; _lockHeld?: boolean;
  }): Promise<BookingRow> {
    if (!data._lockHeld) return SchedulingMutationLockService.run(data.organizationId, () => this.createBooking({ ...data, _lockHeld: true }));
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
    const [conflict] = await db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.organizationId, data.organizationId), data.assignedUserId ? eq(bookings.assignedUserId, data.assignedUserId) : undefined, ne(bookings.status, "cancelled"), lt(bookings.startsAt, conflictEnd), gt(bookings.endsAt, conflictStart))).limit(1);
    if (conflict) throw new Error("Booking conflict");
    let providerAvailable = false;
    if (data.assignedUserId) {
      const provider = await CalendarProviderFactory.forUser(data.organizationId, data.assignedUserId);
      providerAvailable = Boolean(provider);
      if (provider) {
        const busy = await provider.listBusyIntervals({ from: conflictStart, to: conflictEnd });
        if (busy.some((interval) => overlaps(conflictStart, conflictEnd, interval.start, interval.end))) throw new Error("External calendar conflict");
      }
    }
    const [booking] = await db.insert(bookings).values({ organizationId: data.organizationId, meetingTypeId: data.meetingTypeId, assignedUserId: data.assignedUserId, customerId: data.customerId, conversationId: data.conversationId, guestEmail: data.guestEmail?.trim().toLowerCase().slice(0, 254), guestName: data.guestName?.trim().slice(0, 120), startsAt: data.startsAt, endsAt, timezone: data.timezone, idempotencyKey: data.idempotencyKey?.slice(0, 120), createdBy: data.createdBy?.slice(0, 40) || "system" }).returning();
    await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "booking.created", actorType: data.createdBy || "system" });

    let result = booking;
    if (providerAvailable) {
      try {
        await attemptCalendarSync({ organizationId: data.organizationId, bookingId: booking.id, action: "create" });
        const [refreshed] = await db.select().from(bookings).where(and(eq(bookings.organizationId, data.organizationId), eq(bookings.id, booking.id))).limit(1);
        if (refreshed) result = refreshed;
      } catch (error) {
        await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "calendar.sync_failed", actorType: "system", metadata: { action: "create", error: (error as Error).message.slice(0, 500) } });
      }
    }

    await emitBookingEvent("booking.created", result);
    return result;
  }

  static async rescheduleBooking(data: { organizationId: string; bookingId: string; startsAt: Date; timezone: string; actorType: string; actorUserId?: string; expectedCustomerId?: string; _lockHeld?: boolean }): Promise<BookingRow> {
    if (!data._lockHeld) return SchedulingMutationLockService.run(data.organizationId, () => this.rescheduleBooking({ ...data, _lockHeld: true }));
    if (!validTimezone(data.timezone) || Number.isNaN(data.startsAt.getTime())) throw new Error("Invalid booking time");
    const [existing] = await db.select().from(bookings).where(and(
      eq(bookings.organizationId, data.organizationId),
      eq(bookings.id, data.bookingId),
      data.expectedCustomerId ? eq(bookings.customerId, data.expectedCustomerId) : undefined,
      ne(bookings.status, "cancelled"),
    )).limit(1);
    if (!existing) throw new Error("Booking not found");
    const [type] = await db.select().from(meetingTypes).where(and(eq(meetingTypes.organizationId, data.organizationId), eq(meetingTypes.id, existing.meetingTypeId))).limit(1);
    if (!type) throw new Error("Meeting type not found");
    const now = new Date();
    if (data.startsAt.getTime() < now.getTime() + type.minimumNoticeMinutes * 60_000) throw new Error("Booking violates minimum notice");
    if (data.startsAt.getTime() > now.getTime() + type.maxFutureDays * 86_400_000) throw new Error("Booking exceeds allowed future range");
    const endsAt = new Date(data.startsAt.getTime() + type.durationMinutes * 60_000);
    const conflictStart = new Date(data.startsAt.getTime() - type.bufferBeforeMinutes * 60_000);
    const conflictEnd = new Date(endsAt.getTime() + type.bufferAfterMinutes * 60_000);
    const [conflict] = await db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.organizationId, data.organizationId), existing.assignedUserId ? eq(bookings.assignedUserId, existing.assignedUserId) : undefined, ne(bookings.id, existing.id), ne(bookings.status, "cancelled"), lt(bookings.startsAt, conflictEnd), gt(bookings.endsAt, conflictStart))).limit(1);
    if (conflict) throw new Error("Booking conflict");

    let providerAvailable = false;
    if (existing.assignedUserId) {
      const provider = await CalendarProviderFactory.forUser(data.organizationId, existing.assignedUserId);
      providerAvailable = Boolean(provider);
      if (provider) {
        const busy = await provider.listBusyIntervals({ from: conflictStart, to: conflictEnd });
        const relevant = busy.filter((item) => !sameInterval(item.start, item.end, existing.startsAt, existing.endsAt));
        if (relevant.some((item) => overlaps(conflictStart, conflictEnd, item.start, item.end))) throw new Error("External calendar conflict");
      }
    }

    const [updated] = await db.update(bookings).set({ startsAt: data.startsAt, endsAt, timezone: data.timezone, updatedAt: new Date() }).where(and(eq(bookings.organizationId, data.organizationId), eq(bookings.id, existing.id))).returning();
    await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: existing.id, type: "booking.rescheduled", actorType: data.actorType, actorUserId: data.actorUserId, metadata: { from: existing.startsAt.toISOString(), to: data.startsAt.toISOString() } });

    if (providerAvailable || existing.providerEventId) {
      try {
        await attemptCalendarSync({ organizationId: data.organizationId, bookingId: existing.id, action: "update" });
      } catch (error) {
        await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: existing.id, type: "calendar.sync_failed", actorType: "system", metadata: { action: "update", error: (error as Error).message.slice(0, 500) } });
      }
    }

    await emitBookingEvent("booking.rescheduled", updated);
    return updated;
  }

  static async cancelBooking(data: { organizationId: string; bookingId: string; actorType: string; actorUserId?: string; expectedCustomerId?: string; _lockHeld?: boolean }): Promise<BookingRow> {
    if (!data._lockHeld) return SchedulingMutationLockService.run(data.organizationId, () => this.cancelBooking({ ...data, _lockHeld: true }));
    const [existing] = await db.select().from(bookings).where(and(
      eq(bookings.organizationId, data.organizationId),
      eq(bookings.id, data.bookingId),
      data.expectedCustomerId ? eq(bookings.customerId, data.expectedCustomerId) : undefined,
    )).limit(1);
    if (!existing || existing.status === "cancelled") throw new Error("Booking not found");

    const [booking] = await db.update(bookings).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(bookings.organizationId, data.organizationId), eq(bookings.id, data.bookingId), ne(bookings.status, "cancelled"))).returning();
    if (!booking) throw new Error("Booking not found");
    await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "booking.cancelled", actorType: data.actorType, actorUserId: data.actorUserId });

    if (existing.providerEventId && existing.assignedUserId) {
      try {
        await attemptCalendarSync({ organizationId: data.organizationId, bookingId: booking.id, action: "delete" });
      } catch (error) {
        await db.insert(bookingEvents).values({ organizationId: data.organizationId, bookingId: booking.id, type: "calendar.sync_failed", actorType: "system", metadata: { action: "delete", error: (error as Error).message.slice(0, 500) } });
      }
    }

    await emitBookingEvent("booking.cancelled", booking);
    return booking;
  }

  static async listBookings(organizationId: string, customerId?: string) {
    return db.select().from(bookings).where(and(
      eq(bookings.organizationId, organizationId),
      customerId ? eq(bookings.customerId, customerId) : undefined,
    )).orderBy(asc(bookings.startsAt));
  }
}
