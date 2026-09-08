import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { SchedulingService } from "../services/schedulingService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for scheduling concurrency integration tests");

const organizationId = randomUUID();
const meetingTypeId = randomUUID();
const customerA = randomUUID();
const customerB = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
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

    const results = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return Promise.allSettled([
        SchedulingService.createBooking({
          organizationId,
          meetingTypeId,
          customerId: customerA,
          startsAt,
          timezone: "Europe/Berlin",
          idempotencyKey: `race-a-${randomUUID()}`,
          createdBy: "test",
        }),
        SchedulingService.createBooking({
          organizationId,
          meetingTypeId,
          customerId: customerB,
          startsAt,
          timezone: "Europe/Berlin",
          idempotencyKey: `race-b-${randomUUID()}`,
          createdBy: "test",
        }),
      ]);
    });

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    assert.equal(fulfilled.length, 1, "exactly one concurrent booking must succeed");
    assert.equal(rejected.length, 1, "exactly one concurrent booking must be rejected");
    assert.match(String(rejected[0].reason?.message || rejected[0].reason), /Booking conflict/, "losing request must fail as a booking conflict");

    const persisted = await admin.query(
      "SELECT id, customer_id FROM bookings WHERE organization_id = $1 AND status <> 'cancelled'",
      [organizationId],
    );
    assert.equal(persisted.rowCount, 1, "database must contain only one active booking for the contested slot");

    console.log("Scheduling concurrency integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
