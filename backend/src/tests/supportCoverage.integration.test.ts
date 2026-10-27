import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { supportTeams } from "../db/teamRoutingSchema.js";
import { notifications } from "../db/notificationSchema.js";
import { tickets } from "../db/schema.js";
import { SupportCoverageService } from "../services/supportCoverageService.js";
import { TeamRoutingService } from "../services/teamRoutingService.js";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL required");
const admin = new pg.Client({ connectionString: url });
const org = randomUUID(), otherOrg = randomUUID();
const primary = randomUUID(), backup = randomUUID(), outsider = randomUUID();
const team = randomUUID(), otherTeam = randomUUID();
const customer = randomUUID(), ticketId = randomUUID(), otherTicketId = randomUUID();

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Coverage Test', $2), ($3, 'Other Coverage', $4)",
      [org, `coverage-${org}`, otherOrg, `coverage-${otherOrg}`]);
    for (const [id, name] of [[primary, "Primary"], [backup, "Backup"], [outsider, "Outsider"]]) {
      await admin.query("INSERT INTO users (id,email,password_hash,name) VALUES ($1,$2,'test-not-for-login',$3)",
        [id, `coverage-${id}@example.test`, name]);
    }
    await admin.query("INSERT INTO organization_members (organization_id,user_id,role,status) VALUES ($1,$2,'owner','active'), ($1,$3,'agent','active'), ($4,$5,'agent','active')",
      [org, primary, backup, otherOrg, outsider]);
    await admin.query("INSERT INTO customers (id,organization_id,email,name) VALUES ($1,$2,'coverage@example.test','Coverage Customer')",
      [customer, org]);
    await admin.query("INSERT INTO support_teams (id,organization_id,name) VALUES ($1,$2,'Coverage'), ($3,$4,'Private')",
      [team, org, otherTeam, otherOrg]);
    await admin.query("INSERT INTO support_team_members (organization_id,team_id,user_id) VALUES ($1,$2,$3),($1,$2,$4)",
      [org, team, primary, backup]);
    await admin.query("INSERT INTO agent_presence (organization_id,user_id,status,updated_at) VALUES ($1,$2,'ONLINE',now()),($1,$3,'ONLINE',now())",
      [org, primary, backup]);
    await admin.query("INSERT INTO tickets (id,organization_id,customer_id,ticket_number,subject,status,priority) VALUES ($1,$2,$3,9001,'Coverage ticket','open','normal')",
      [ticketId, org, customer]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(org);
      const foreign = await db.select({ id: supportTeams.id }).from(supportTeams)
        .where(eq(supportTeams.id, otherTeam));
      assert.equal(foreign.length, 0, "other tenant team must not be visible");

      const now = Date.now();
      const absencePrimary = await SupportCoverageService.createAbsence(org, {
        userId: primary, startsAt: new Date(now-60_000).toISOString(),
        endsAt: new Date(now+60*60_000).toISOString(), reason: "vacation",
      });
      const first = await TeamRoutingService.routeTicket(org, ticketId);
      assert.equal(first.assigned, true, "ticket should be assigned");
      if (!first.assigned) throw new Error("expected assignment");
      assert.equal(first.agentId, backup, "absent primary must not receive ticket");
      const roster = await SupportCoverageService.roster(org);
      assert.equal(roster.find(p=>p.userId===primary)?.status, "absent");
      assert.equal(roster.find(p=>p.userId===backup)?.openTickets, 1);

      assert.equal(await SupportCoverageService.deleteAbsence(org, absencePrimary.id), true);
      await SupportCoverageService.createAbsence(org, {
        userId: backup, startsAt: new Date(now-60_000).toISOString(),
        endsAt: new Date(now+60*60_000).toISOString(), reason: "other",
      });
      const sweep = await SupportCoverageService.sweepOrganization(org);
      assert.equal(sweep.redistributed, 1, "active absence should reassign assigned ticket");
      const [reassigned] = await db.select().from(tickets).where(and(
        eq(tickets.organizationId,org),eq(tickets.id,ticketId)));
      assert.equal(reassigned.assignedAgentId, primary, "primary agent should cover backup");
      const again = await SupportCoverageService.sweepOrganization(org);
      assert.equal(again.redistributed, 0, "repeat sweep must not reassign again");

      await SupportCoverageService.upsertSchedule(org, primary, {
        timezone: "Europe/Berlin", weeklyShifts: [
          { day: 0, start: "00:00", end: "23:59" },
          { day: 1, start: "00:00", end: "23:59" },
          { day: 2, start: "00:00", end: "23:59" },
          { day: 3, start: "00:00", end: "23:59" },
          { day: 4, start: "00:00", end: "23:59" },
          { day: 5, start: "00:00", end: "23:59" },
          { day: 6, start: "00:00", end: "23:59" },
        ], backupUserId: backup, autoRedistribute: true, maxOpenTickets: 1,
      });
      await admin.query("INSERT INTO tickets (id,organization_id,customer_id,ticket_number,subject,status,priority) VALUES ($1,$2,$3,9002,'Overflow ticket','open','normal')",
        [otherTicketId,org,customer]);
      const second = await TeamRoutingService.routeTicket(org,otherTicketId);
      assert.equal(second.assigned,false,"at-capacity and absent members must not be selected");
      assert.equal("reason" in second ? second.reason : "", "no_available_team_member");
      await SupportCoverageService.sweepOrganization(org);
      await SupportCoverageService.sweepOrganization(org);
      const warnings = await db.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.organizationId,org),eq(notifications.resourceId,otherTicketId),
        eq(notifications.type,"ticket.coverage_missing")));
      assert.equal(warnings.length,1,"coverage warnings must be deduplicated across sweeps");
    });
    console.log("Support coverage integration test passed");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id IN ($1,$2)",[org,otherOrg]).catch(()=>undefined);
    await admin.query("DELETE FROM users WHERE id IN ($1,$2,$3)",[primary,backup,outsider]).catch(()=>undefined);
    await admin.end();
    await closeDatabasePool();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
