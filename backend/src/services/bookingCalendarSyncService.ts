import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { organizations } from "../db/schema.js";
import { bookingCalendarSync } from "../db/bookingCalendarSyncSchema.js";
import { bookings, meetingTypes } from "../db/extendedCustomerExperienceSchema.js";
import { CalendarProviderFactory } from "./calendarProviderFactory.js";

const MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.CALENDAR_SYNC_MAX_ATTEMPTS || 8), 20));
const STALE_MS = Math.max(60_000, Number(process.env.CALENDAR_SYNC_STALE_MS || 10 * 60_000));

function retryDelayMs(attempt: number) {
  return Math.min(60 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

export type BookingCalendarSyncAction = "create" | "update" | "delete";

type SyncResult = {
  processed: boolean;
  status?: "synced" | "failed" | "exhausted";
  error?: string;
};

export class BookingCalendarSyncService {
  static async enqueue(organizationId: string, bookingId: string, action: BookingCalendarSyncAction) {
    const now = new Date();
    const [row] = await db.insert(bookingCalendarSync).values({
      organizationId,
      bookingId,
      action,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      lastAttemptAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [bookingCalendarSync.organizationId, bookingCalendarSync.bookingId],
      set: {
        action,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        lastAttemptAt: null,
        updatedAt: now,
      },
    }).returning();
    return row;
  }

  private static async claim(organizationId: string, bookingId: string) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_MS);
    const [claimed] = await db.update(bookingCalendarSync).set({
      status: "processing",
      lastAttemptAt: now,
      updatedAt: now,
    }).where(and(
      eq(bookingCalendarSync.organizationId, organizationId),
      eq(bookingCalendarSync.bookingId, bookingId),
      or(
        and(
          inArray(bookingCalendarSync.status, ["pending", "failed"]),
          or(isNull(bookingCalendarSync.nextAttemptAt), lte(bookingCalendarSync.nextAttemptAt, now)),
        ),
        and(eq(bookingCalendarSync.status, "processing"), lt(bookingCalendarSync.lastAttemptAt, staleBefore)),
      ),
    )).returning();
    return claimed;
  }

  static async processOne(organizationId: string, bookingId: string): Promise<SyncResult> {
    const claimed = await this.claim(organizationId, bookingId);
    if (!claimed) return { processed: false };

    const attempt = claimed.attempts + 1;
    try {
      const [booking] = await db.select().from(bookings).where(and(
        eq(bookings.organizationId, organizationId),
        eq(bookings.id, bookingId),
      )).limit(1);
      if (!booking) {
        await db.delete(bookingCalendarSync).where(and(
          eq(bookingCalendarSync.organizationId, organizationId),
          eq(bookingCalendarSync.bookingId, bookingId),
        ));
        return { processed: true, status: "synced" };
      }

      if (!booking.assignedUserId) {
        await this.markSynced(organizationId, bookingId, attempt);
        return { processed: true, status: "synced" };
      }

      const provider = await CalendarProviderFactory.forUser(organizationId, booking.assignedUserId);
      if (!provider) throw new Error("Calendar provider is unavailable for assigned user");

      if (claimed.action === "delete") {
        if (booking.providerEventId) await provider.deleteEvent(booking.providerEventId);
        await db.update(bookings).set({ providerEventId: null, meetingUrl: null, updatedAt: new Date() }).where(and(
          eq(bookings.organizationId, organizationId),
          eq(bookings.id, bookingId),
        ));
        await this.markSynced(organizationId, bookingId, attempt);
        return { processed: true, status: "synced" };
      }

      const [type] = await db.select().from(meetingTypes).where(and(
        eq(meetingTypes.organizationId, organizationId),
        eq(meetingTypes.id, booking.meetingTypeId),
      )).limit(1);
      if (!type) throw new Error("Meeting type not found for calendar sync");

      const input = {
        title: type.name,
        description: type.description || undefined,
        start: booking.startsAt,
        end: booking.endsAt,
        timezone: booking.timezone,
        attendeeEmail: booking.guestEmail || undefined,
        attendeeName: booking.guestName || undefined,
      };

      if (booking.providerEventId) {
        const result = await provider.updateEvent(booking.providerEventId, input);
        await db.update(bookings).set({
          meetingUrl: result.meetingUrl || booking.meetingUrl,
          updatedAt: new Date(),
        }).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId)));
      } else {
        const result = await provider.createEvent(input);
        try {
          await db.update(bookings).set({
            providerEventId: result.externalEventId,
            meetingUrl: result.meetingUrl,
            updatedAt: new Date(),
          }).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId)));
        } catch (persistError) {
          try {
            await provider.deleteEvent(result.externalEventId);
          } catch (compensationError) {
            const persistenceMessage = persistError instanceof Error ? persistError.message : "booking persistence failed";
            const compensationMessage = compensationError instanceof Error ? compensationError.message : "calendar compensation failed";
            throw new Error(`Calendar event persistence failed and orphan compensation failed: ${persistenceMessage}; ${compensationMessage}`);
          }
          throw persistError;
        }
      }

      await this.markSynced(organizationId, bookingId, attempt);
      return { processed: true, status: "synced" };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Calendar sync failed";
      const terminal = attempt >= MAX_ATTEMPTS;
      await db.update(bookingCalendarSync).set({
        status: terminal ? "exhausted" : "failed",
        attempts: attempt,
        lastError: message,
        nextAttemptAt: terminal ? null : new Date(Date.now() + retryDelayMs(attempt)),
        updatedAt: new Date(),
      }).where(and(
        eq(bookingCalendarSync.organizationId, organizationId),
        eq(bookingCalendarSync.bookingId, bookingId),
      ));
      return { processed: true, status: terminal ? "exhausted" : "failed", error: message };
    }
  }

  private static async markSynced(organizationId: string, bookingId: string, attempts: number) {
    await db.update(bookingCalendarSync).set({
      status: "synced",
      attempts,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(bookingCalendarSync.organizationId, organizationId),
      eq(bookingCalendarSync.bookingId, bookingId),
    ));
  }

  static async retry(organizationId: string, bookingId: string) {
    const [row] = await db.update(bookingCalendarSync).set({
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(bookingCalendarSync.organizationId, organizationId),
      eq(bookingCalendarSync.bookingId, bookingId),
      inArray(bookingCalendarSync.status, ["failed", "exhausted"]),
    )).returning();
    return row;
  }

  static async processPending(organizationId: string, limit = 25) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_MS);
    const rows = await db.select({ bookingId: bookingCalendarSync.bookingId }).from(bookingCalendarSync).where(and(
      eq(bookingCalendarSync.organizationId, organizationId),
      or(
        and(
          inArray(bookingCalendarSync.status, ["pending", "failed"]),
          or(isNull(bookingCalendarSync.nextAttemptAt), lte(bookingCalendarSync.nextAttemptAt, now)),
        ),
        and(eq(bookingCalendarSync.status, "processing"), lt(bookingCalendarSync.lastAttemptAt, staleBefore)),
      ),
    )).limit(Math.max(1, Math.min(limit, 100)));

    let processed = 0;
    let synced = 0;
    let failed = 0;
    for (const row of rows) {
      const result = await this.processOne(organizationId, row.bookingId);
      if (!result.processed) continue;
      processed += 1;
      if (result.status === "synced") synced += 1;
      else failed += 1;
    }
    return { processed, synced, failed };
  }

  static async sweepAll(shouldStop?: () => boolean) {
    const tenants = await db.select({ id: organizations.id }).from(organizations).limit(10_000);
    let processed = 0;
    let synced = 0;
    let failed = 0;
    for (const tenant of tenants) {
      if (shouldStop?.()) break;
      const result = await withDatabaseTenantContext(async () => {
        setDatabaseTenant(tenant.id);
        return this.processPending(tenant.id);
      });
      processed += result.processed;
      synced += result.synced;
      failed += result.failed;
    }
    return { processed, synced, failed };
  }
}
