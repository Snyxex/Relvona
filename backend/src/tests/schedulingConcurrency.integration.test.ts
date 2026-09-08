import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { SchedulingService } from "../services/schedulingService.js";
import { domainEventBus, type DomainEventType } from "../services/domainEventBus.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for scheduling concurrency integration tests");

const organizationId = randomUUID();
const meetingTypeId = randomUUID();
const customerA = randomUUID();
const customerB = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  const emitted: DomainEventType[] = [];
  const unsubscribers = (["booking.created", "booking.rescheduled", "booking.cancelled"] as DomainEventType[])
    .map((type) => domainEventBus.subscribe(type, (event) => {
      if (event.organizationId === organizationId) emitted.push(event.type);
    }));

  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'Scheduling Race Test', $2, $3)",
      [organizationId, `scheduling-race-${organizationId}`, `race-key-${organizationId}`],
    );
    await admin.query(
      "INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $3, 'race-a@example.test', 'Race A'), ($2, $3, 'race-b@example.test', 'Race B')",
      [customerA, customerB, organizationId],
    );
    await admin.query(
      "INSERT INTO meeting_types (id, organization_id, name, slug, duration_minutes, minimum_notice_minutes, max_future_days) VALUES ($1, $2, 'Race Meeting', $3, 30, 0, 30)",
      [meetingTypeId, organizationId, `race-${meetingTypeId}`],
    );

    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    startsAt.setUTCMinutes(0, 0, 0);
    const keyA = `race-a-${randomUUID()}`;
    const keyB = `race-b-${randomUUID()}`;

    const results = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return Promise.allSettled([
        SchedulingService.createBooking({
          organizationId,
          meetingTypeId,
          customerId: customerA,
          startsAt,
          timezone: "Europe/Berlin",
          idempotencyKey: keyA,
          createdBy: "test",
        }),
        SchedulingService.createBooking({
          organizationId,
          meetingTypeId,
          customerId: customerB,
          startsAt,
          timezone: "Europe/Berlin",
          idempotencyKey: keyB,
          createdBy: "test",
        }),
      ]);
    });

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    assert.equal(fulfilled.length, 1, "exactly one concurrent booking must succeed");
    assert.equal(rejected.length, 1, "exactly one concurrent booking must be rejected");
    assert.match(String(rejected[0].reason?.message || rejected[0].reason), /Booking conflict/, "losing request must fail as a booking conflict");
    assert.deepEqual(emitted, ["booking.created"], "exactly one booking.created event must be emitted for the winning mutation");

    const persisted = await admin.query(
      "SELECT id, customer_id FROM bookings WHERE organization_id = $1 AND status <> 'cancelled'",
      [organizationId],
    );
    assert.equal(persisted.rowCount, 1, "database must contain only one active booking for the contested slot");
    const bookingId = persisted.rows[0].id as string;
    const winnerCustomerId = persisted.rows[0].customer_id as string;
    const winnerKey = winnerCustomerId === customerA ? keyA : keyB;

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const replay = await SchedulingService.createBooking({
        organizationId,
        meetingTypeId,
        customerId: winnerCustomerId,
        startsAt,
        timezone: "Europe/Berlin",
        idempotencyKey: winnerKey,
        createdBy: "test",
      });
      assert.equal(replay.id, bookingId, "idempotent replay must return the existing booking");
    });
    assert.deepEqual(emitted, ["booking.created"], "idempotent create replay must not emit a duplicate domain event");

    const rescheduledStart = new Date(startsAt.getTime() + 2 * 60 * 60_000);
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await SchedulingService.rescheduleBooking({
        organizationId,
        bookingId,
        startsAt: rescheduledStart,
        timezone: "Europe/Berlin",
        actorType: "test",
      });
      await SchedulingService.cancelBooking({ organizationId, bookingId, actorType: "test" });
    });

    assert.deepEqual(
      emitted,
      ["booking.created", "booking.rescheduled", "booking.cancelled"],
      "successful booking mutations must emit their matching domain events exactly once",
    );

    console.log("Scheduling concurrency and domain event integration test passed.");
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
