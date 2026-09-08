import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { toolRegistry } from "../services/toolRegistry.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for customer tool isolation integration tests");

const organizationId = randomUUID();
const customerA = randomUUID();
const customerB = randomUUID();
const meetingTypeId = randomUUID();
const bookingA = randomUUID();
const bookingB = randomUUID();
const ticketA = randomUUID();
const ticketB = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function inTenant<T>(work: () => Promise<T>): Promise<T> {
  return withDatabaseTenantContext(async () => {
    setDatabaseTenant(organizationId);
    return work();
  });
}

async function main() {
  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'Customer Tool Isolation', $2, $3)",
      [organizationId, `tool-isolation-${organizationId}`, `tool-key-${organizationId}`],
    );
    await admin.query(
      "INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $3, 'a@tool.test', 'Customer A'), ($2, $3, 'b@tool.test', 'Customer B')",
      [customerA, customerB, organizationId],
    );
    await admin.query(
      "INSERT INTO meeting_types (id, organization_id, name, slug, duration_minutes, minimum_notice_minutes) VALUES ($1, $2, 'Support Call', $3, 30, 0)",
      [meetingTypeId, organizationId, `support-call-${meetingTypeId}`],
    );
    const startA = new Date(Date.now() + 3 * 86_400_000);
    const startB = new Date(Date.now() + 4 * 86_400_000);
    await admin.query(
      "INSERT INTO bookings (id, organization_id, meeting_type_id, customer_id, starts_at, ends_at, timezone) VALUES ($1, $3, $4, $5, $6, $7, 'Europe/Berlin'), ($2, $3, $4, $8, $9, $10, 'Europe/Berlin')",
      [bookingA, bookingB, organizationId, meetingTypeId, customerA, startA, new Date(startA.getTime() + 30 * 60_000), customerB, startB, new Date(startB.getTime() + 30 * 60_000)],
    );
    await admin.query(
      "INSERT INTO tickets (id, ticket_number, organization_id, customer_id, subject) VALUES ($1, 9101, $3, $4, 'Ticket A'), ($2, 9102, $3, $5, 'Ticket B')",
      [ticketA, ticketB, organizationId, customerA, customerB],
    );

    await inTenant(async () => {
      const customerContext = { organizationId, customerId: customerA, actorRole: "agent" };

      const ticketTool = toolRegistry.get("support.get_ticket_case");
      assert(ticketTool, "ticket case tool must be registered");
      const ownTicket = await ticketTool.execute(customerContext, { ticketId: ticketA });
      assert.equal(ownTicket.success, true, "customer context must be able to read its own ticket");
      const foreignTicket = await ticketTool.execute(customerContext, { ticketId: ticketB });
      assert.equal(foreignTicket.success, false, "customer context must not read another customer's ticket");
      assert.equal(foreignTicket.error, "Ticket not found", "cross-customer ticket lookup must be enumeration-resistant");

      const listTool = toolRegistry.get("scheduling.list_bookings");
      assert(listTool, "booking list tool must be registered");
      const listed = await listTool.execute(customerContext, {});
      assert.equal(listed.success, true);
      const rows = (listed.data?.bookings || []) as Array<{ id: string; customerId: string | null }>;
      assert.deepEqual(rows.map((row) => row.id), [bookingA], "customer context must only receive its own bookings");

      const cancelTool = toolRegistry.get("scheduling.cancel_booking");
      assert(cancelTool, "cancel booking tool must be registered");
      const foreignCancel = await cancelTool.execute(customerContext, { bookingId: bookingB });
      assert.equal(foreignCancel.success, false, "customer context must not cancel another customer's booking");
      assert.equal(foreignCancel.error, "Booking not found");

      const rescheduleTool = toolRegistry.get("scheduling.reschedule_booking");
      assert(rescheduleTool, "reschedule booking tool must be registered");
      const foreignReschedule = await rescheduleTool.execute(customerContext, {
        bookingId: bookingB,
        startsAt: new Date(startB.getTime() + 60 * 60_000).toISOString(),
        timezone: "Europe/Berlin",
      });
      assert.equal(foreignReschedule.success, false, "customer context must not reschedule another customer's booking");
      assert.equal(foreignReschedule.error, "Booking not found");
    });

    const foreignBooking = await admin.query("SELECT status, starts_at FROM bookings WHERE id = $1", [bookingB]);
    assert.equal(foreignBooking.rows[0]?.status, "confirmed", "foreign booking must remain unchanged after blocked mutations");
    assert.equal(new Date(foreignBooking.rows[0]?.starts_at).getTime(), startB.getTime(), "foreign booking time must remain unchanged");

    console.log("Same-tenant customer tool isolation integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.end();
    await closeDatabasePool().catch(() => undefined);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
