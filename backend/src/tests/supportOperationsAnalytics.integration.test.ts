import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { SupportOperationsAnalyticsService } from "../services/supportOperationsAnalyticsService.js";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL required for support analytics integration");
const admin = new pg.Client({ connectionString: url });
const org = randomUUID(), foreignOrg = randomUUID(), customer = randomUUID(), foreignCustomer = randomUUID();
const firstTicket = randomUUID(), secondTicket = randomUUID(), legacyTicket = randomUUID(), foreignTicket = randomUUID();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Analytics Tenant A',$2),($3,'Analytics Tenant B',$4)",
      [org, `analytics-${org}`, foreignOrg, `analytics-${foreignOrg}`]);
    await admin.query("INSERT INTO customers (id,organization_id,email,name) VALUES ($1,$2,'a-analytics@example.test','A'), ($3,$4,'b-analytics@example.test','B')",
      [customer, org, foreignCustomer, foreignOrg]);
    await admin.query(`INSERT INTO tickets (id,organization_id,customer_id,ticket_number,subject,status,created_at)
      VALUES ($1,$2,$3,5001,'First SLA','resolved',$4),($5,$2,$3,5002,'Second SLA','open',$6),
             ($7,$2,$3,5003,'Legacy no case','open',$8),($9,$10,$11,9001,'Foreign','open',$12)`,
      [firstTicket, org, customer, ago(180), secondTicket, ago(120), legacyTicket, ago(60),
        foreignTicket, foreignOrg, foreignCustomer, ago(30)]);
    await admin.query(`INSERT INTO ticket_case_metadata
      (organization_id,ticket_id,first_response_due_at,resolution_due_at,first_responded_at,resolved_at)
      VALUES ($1,$2,$3,$4,$5,$6),($1,$7,$8,$9,null,null)`, [
      org, firstTicket, ago(150), ahead(60), ago(160), ago(50),
      secondTicket, ago(60), ahead(90),
    ]);
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(org);
      const report = await SupportOperationsAnalyticsService.report(org, 30);
      assert.equal(report.tickets.openedInRange, 3, "only tenant's tickets count in cohort");
      assert.equal(report.sla.trackedCases, 2, "case coverage excludes legacy tickets");
      assert.equal(report.sla.firstResponse.evaluated, 2);
      assert.equal(report.sla.firstResponse.met, 1);
      assert.equal(report.sla.firstResponse.breached, 1);
      assert.equal(report.sla.firstResponse.complianceRate, 0.5);
      assert.equal(report.sla.resolution.evaluated, 1, "not-yet-due SLA must not count as breach");
      assert.equal(report.sla.resolution.met, 1);
      assert.equal(report.sla.resolution.complianceRate, 1);
      assert.equal(report.tickets.currentBacklog, 2);
      assert.equal(report.tickets.unassigned, 2);
      assert.equal(report.teams.length, 0);
      assert.equal(report.agents.length, 0);
      assert.equal(report.forecast.risk, "no_coverage");
      assert.equal(report.daily.reduce((sum,d) => sum + d.arrivals, 0), 3);
      assert.equal(report.daily.reduce((sum,d) => sum + d.resolutions, 0), 1);
      await assert.rejects(SupportOperationsAnalyticsService.report(org, 0), /Invalid report range/);
      const repeated = await SupportOperationsAnalyticsService.report(org, 30);
      assert.equal(repeated.tickets.openedInRange, 3, "report must be repeatable and read-only");
    });
    console.log("Support operations analytics integration tests passed");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id IN ($1,$2)", [org, foreignOrg]).catch(() => undefined);
    await admin.end();
    await closeDatabasePool();
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
