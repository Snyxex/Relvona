import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { closeDatabasePool } from "../db/index.js";
import { DashboardOverviewService } from "../services/dashboardOverviewService.js";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL must point at a disposable integration database");
const client = new pg.Client({ connectionString: url });
const a = randomUUID(), b = randomUUID();
const customerA = randomUUID(), customerB = randomUUID();
const ticketA = randomUUID(), ticketB = randomUUID(), convA = randomUUID(), convB = randomUUID();
const meetingTypeA = randomUUID(), meetingTypeB = randomUUID(), bookingA = randomUUID(), bookingB = randomUUID();
async function run() {
  await client.connect();
  try {
    await client.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Dashboard Alpha',$2),($3,'Dashboard Beta',$4)",
      [a,`dashboard-${a}`,b,`dashboard-${b}`]);
    await client.query("INSERT INTO customers (id,organization_id,name,email) VALUES ($1,$2,'Alpha','alpha-dash@example.test'),($3,$4,'Beta','beta-dash@example.test')",
      [customerA,a,customerB,b]);
    await client.query("INSERT INTO tickets (id,organization_id,customer_id,ticket_number,subject,status,tags) VALUES ($1,$2,$3,910001,'Alpha issue','open','[\"Billing\"]'::jsonb), ($4,$5,$6,910002,'Beta issue','resolved','[\"Private\"]'::jsonb)",
      [ticketA,a,customerA,ticketB,b,customerB]);
    await client.query("INSERT INTO conversations (id,organization_id,customer_id,state) VALUES ($1,$2,$3,'AI_ACTIVE'),($4,$5,$6,'RESOLVED')",
      [convA,a,customerA,convB,b,customerB]);
    await client.query(
      "INSERT INTO meeting_types (id,organization_id,name,slug,duration_minutes) VALUES ($1,$2,'Demo A','demo-a',30),($3,$4,'Private B','private-b',30)",
      [meetingTypeA, a, meetingTypeB, b],
    );
    const start = new Date(Date.now() + 3_600_000);
    const end = new Date(start.getTime() + 1_800_000);
    await client.query(
      "INSERT INTO bookings (id,organization_id,meeting_type_id,starts_at,ends_at,timezone,status,guest_name,meeting_url) VALUES ($1,$2,$3,$4,$5,'UTC','confirmed','Alpha Guest','https://example.test/a'),($6,$7,$8,$4,$5,'UTC','confirmed','Secret Guest','https://example.test/b')",
      [bookingA, a, meetingTypeA, start, end, bookingB, b, meetingTypeB],
    );
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(a);
      const report = await DashboardOverviewService.get(a,30, { canViewTickets: true, canViewScheduling: true });
      assert.equal(report.kpis.tickets, 1, "only organization A's tickets count");
      assert.equal(report.kpis.conversations, 1, "only organization A's conversations count");
      assert.equal(report.kpis.appointments, 1);
      assert.equal(report.kpis.upcomingAppointments, 1);
      assert.equal(report.upcomingAppointments.length, 1);
      assert.equal(report.upcomingAppointments[0].guestName, "Alpha Guest");
      assert.equal(report.upcomingAppointments[0].meetingUrl, "https://example.test/a");
      assert.equal(report.statusTotal, 1);
      assert.equal(report.status.length, 1);
      assert.equal(report.status[0].status, "open");
      assert.equal(report.categoriesTotal, 1);
      assert.equal(report.categories[0].name, "Billing");
      assert.equal(report.recentTickets.length, 1);
      assert.equal(report.recentTickets[0].subject, "Alpha issue");
      assert.equal(report.volume.length, 30, "selected range has explicit zero-filled UTC days");
      assert.equal(report.volume.reduce((sum, x) => sum+x.tickets, 0),1);
      assert.equal(report.volume.reduce((sum, x) => sum+x.conversations, 0),1);
      assert.equal(report.kpis.satisfactionRate, null, "unavailable feedback is not replaced with demo ratings");
      const limited = await DashboardOverviewService.get(a, 30, {
        canViewTickets: false, canViewScheduling: false,
      });
      assert.equal(limited.kpis.tickets, 1, "analytics totals can remain available without ticket details");
      assert.deepEqual(limited.recentTickets, [], "ticket subjects and customer names require tickets.view");
      assert.deepEqual(limited.upcomingAppointments, [], "guest names and meeting links require scheduling.view");
      assert.equal(limited.kpis.upcomingAppointments, 1, "aggregate schedule metrics remain available");
      await assert.rejects(
        DashboardOverviewService.get(a, 999, { canViewTickets: true, canViewScheduling: true }),
        /Invalid dashboard range/,
      );
    });
    console.log("Dashboard overview RLS and real-data integration tests passed");
  } finally {
    await client.query("DELETE FROM organizations WHERE id in ($1,$2)",[a,b]).catch(()=>undefined);
    await client.end();
    await closeDatabasePool();
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
