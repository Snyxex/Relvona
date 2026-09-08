import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { bookingCalendarSync } from "../db/bookingCalendarSyncSchema.js";
import { bookings } from "../db/extendedCustomerExperienceSchema.js";
import { BookingCalendarSyncService } from "../services/bookingCalendarSyncService.js";
import { CalendarProviderFactory } from "../services/calendarProviderFactory.js";
import { SchedulingService } from "../services/schedulingService.js";
import { closeSchedulingMutationLockPool } from "../services/schedulingMutationLockService.js";
import type { CalendarProvider } from "../services/calendarProvider.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for calendar reconciliation integration tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const userId = randomUUID();
const customerId = randomUUID();
const meetingTypeId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function tenant<T>(organization: string, work: () => Promise<T>) {
  return withDatabaseTenantContext(async () => {
    setDatabaseTenant(organization);
    return work();
  });
}

async function main() {
  let createFailures = 1;
  let updateFailures = 1;
  let deleteFailures = 1;
  let createCalls = 0;
  let updateCalls = 0;
  let deleteCalls = 0;

  const fakeProvider: CalendarProvider = {
    async listBusyIntervals() { return []; },
    async createEvent() {
      createCalls += 1;
      if (createFailures-- > 0) throw new Error("simulated create failure");
      return { externalEventId: "calendar-event-1", meetingUrl: "https://meeting.example.test/1" };
    },
    async updateEvent(externalEventId) {
      updateCalls += 1;
      assert.equal(externalEventId, "calendar-event-1");
      if (updateFailures-- > 0) throw new Error("simulated update failure");
      return { externalEventId, meetingUrl: "https://meeting.example.test/1" };
    },
    async deleteEvent(externalEventId) {
      deleteCalls += 1;
      assert.equal(externalEventId, "calendar-event-1");
      if (deleteFailures-- > 0) throw new Error("simulated delete failure");
    },
  };

  const originalForUser = CalendarProviderFactory.forUser;
  (CalendarProviderFactory as any).forUser = async (orgId: string, assignedUserId: string) => {
    assert.equal(orgId, organizationId);
    assert.equal(assignedUserId, userId);
    return fakeProvider;
  };

  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'Calendar Reconciliation', $2, $3), ($4, 'Calendar Other', $5, $6)",
      [organizationId, `calendar-reconcile-${organizationId}`, `calendar-key-${organizationId}`, otherOrganizationId, `calendar-other-${otherOrganizationId}`, `calendar-other-key-${otherOrganizationId}`],
    );
    await admin.query(
      "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'test-hash', 'Calendar Agent')",
      [userId, `calendar-agent-${userId}@example.test`],
    );
    await admin.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'agent')",
      [organizationId, userId],
    );
    await admin.query(
      "INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'calendar-customer@example.test', 'Calendar Customer')",
      [customerId, organizationId],
    );
    await admin.query(
      "INSERT INTO meeting_types (id, organization_id, name, slug, duration_minutes, minimum_notice_minutes, max_future_days) VALUES ($1, $2, 'Calendar Meeting', $3, 30, 0, 30)",
      [meetingTypeId, organizationId, `calendar-${meetingTypeId}`],
    );

    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    startsAt.setUTCMinutes(0, 0, 0);
    const booking = await tenant(organizationId, () => SchedulingService.createBooking({
      organizationId,
      meetingTypeId,
      assignedUserId: userId,
      customerId,
      startsAt,
      timezone: "Europe/Berlin",
      idempotencyKey: `calendar-reconcile-${randomUUID()}`,
      createdBy: "test",
    }));

    assert.equal(booking.status, "confirmed", "provider failure must not roll back the local booking");
    assert.equal(booking.providerEventId, null, "failed provider create must not invent an external id");
    assert.equal(createCalls, 1, "inline create sync should be attempted once");

    const failedCreate = await tenant(organizationId, async () => {
      const [row] = await db.select().from(bookingCalendarSync).where(and(
        eq(bookingCalendarSync.organizationId, organizationId),
        eq(bookingCalendarSync.bookingId, booking.id),
      )).limit(1);
      return row;
    });
    assert.equal(failedCreate?.status, "failed", "failed create must remain retryable");
    assert.equal(failedCreate?.action, "create");

    await tenant(organizationId, async () => {
      assert.ok(await BookingCalendarSyncService.retry(organizationId, booking.id));
      const result = await BookingCalendarSyncService.processOne(organizationId, booking.id);
      assert.equal(result.status, "synced");
    });
    assert.equal(createCalls, 2, "retry must create the external event exactly once more");

    const afterCreateRetry = await tenant(organizationId, async () => {
      const [row] = await db.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, booking.id))).limit(1);
      return row;
    });
    assert.equal(afterCreateRetry?.providerEventId, "calendar-event-1");

    const rescheduledStart = new Date(startsAt.getTime() + 2 * 60 * 60_000);
    const rescheduled = await tenant(organizationId, () => SchedulingService.rescheduleBooking({
      organizationId,
      bookingId: booking.id,
      startsAt: rescheduledStart,
      timezone: "Europe/Berlin",
      actorType: "test",
    }));
    assert.equal(rescheduled.startsAt.getTime(), rescheduledStart.getTime(), "local reschedule must commit before provider reconciliation");
    assert.equal(updateCalls, 1, "inline provider update should be attempted once");

    const failedUpdate = await tenant(organizationId, async () => {
      const [row] = await db.select().from(bookingCalendarSync).where(and(eq(bookingCalendarSync.organizationId, organizationId), eq(bookingCalendarSync.bookingId, booking.id))).limit(1);
      return row;
    });
    assert.equal(failedUpdate?.status, "failed");
    assert.equal(failedUpdate?.action, "update");

    await tenant(organizationId, async () => {
      await BookingCalendarSyncService.retry(organizationId, booking.id);
      const result = await BookingCalendarSyncService.processOne(organizationId, booking.id);
      assert.equal(result.status, "synced");
    });
    assert.equal(updateCalls, 2, "reschedule retry should update the existing provider event");

    const cancelled = await tenant(organizationId, () => SchedulingService.cancelBooking({ organizationId, bookingId: booking.id, actorType: "test" }));
    assert.equal(cancelled.status, "cancelled", "local cancellation must commit before provider deletion");
    assert.equal(deleteCalls, 1, "inline provider delete should be attempted once");

    const failedDelete = await tenant(organizationId, async () => {
      const [row] = await db.select().from(bookingCalendarSync).where(and(eq(bookingCalendarSync.organizationId, organizationId), eq(bookingCalendarSync.bookingId, booking.id))).limit(1);
      return row;
    });
    assert.equal(failedDelete?.status, "failed");
    assert.equal(failedDelete?.action, "delete");

    await tenant(organizationId, async () => {
      await BookingCalendarSyncService.retry(organizationId, booking.id);
      const result = await BookingCalendarSyncService.processOne(organizationId, booking.id);
      assert.equal(result.status, "synced");
    });
    assert.equal(deleteCalls, 2, "cancel retry should delete the provider event");

    const afterDeleteRetry = await tenant(organizationId, async () => {
      const [row] = await db.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, booking.id))).limit(1);
      return row;
    });
    assert.equal(afterDeleteRetry?.providerEventId, null, "successful delete reconciliation must clear the provider id");
    assert.equal(afterDeleteRetry?.meetingUrl, null, "successful delete reconciliation must clear the meeting URL");

    const otherTenantRows = await tenant(otherOrganizationId, () => db.select().from(bookingCalendarSync));
    assert.equal(otherTenantRows.length, 0, "calendar reconciliation state must remain tenant-isolated by RLS");

    console.log("Calendar reconciliation integration test passed.");
  } finally {
    (CalendarProviderFactory as any).forUser = originalForUser;
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => undefined);
    await admin.end();
    await closeSchedulingMutationLockPool().catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
