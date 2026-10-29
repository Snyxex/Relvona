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
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(a);
      const report = await DashboardOverviewService.get(a,30);
      assert.equal(report.kpis.tickets, 1, "only organization A's tickets count");
      assert.equal(report.kpis.conversations, 1, "only organization A's conversations count");
      assert.equal(report.kpis.appointments, 0);
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
      await assert.rejects(DashboardOverviewService.get(a,999), /Invalid dashboard range/);
    });
    console.log("Dashboard overview RLS and real-data integration tests passed");
  } finally {
    await client.query("DELETE FROM organizations WHERE id in ($1,$2)",[a,b]).catch(()=>undefined);
    await client.end();
    await closeDatabasePool();
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
