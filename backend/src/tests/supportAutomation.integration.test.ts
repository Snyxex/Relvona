import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { tickets } from "../db/schema.js";
import { notifications } from "../db/notificationSchema.js";
import { supportAutomationRules, supportAutomationRuns } from "../db/supportAutomationSchema.js";
import { SupportAutomationService } from "../services/supportAutomationService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL required");
const admin = new pg.Client({ connectionString: adminUrl });
const org = randomUUID(), otherOrg = randomUUID();
const owner = randomUUID(), agent = randomUUID(), customer = randomUUID(), otherCustomer = randomUUID();
const ticketId = randomUUID(), otherTicket = randomUUID(), idleTicket = randomUUID();

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Automation Test A',$2),($3,'Automation Test B',$4)",
      [org,`automation-${org}`,otherOrg,`automation-${otherOrg}`]);
    await admin.query("INSERT INTO users (id,email,password_hash,name) VALUES ($1,$2,'not-for-login','Owner'),($3,$4,'not-for-login','Agent')",
      [owner,`owner-${owner}@example.test`,agent,`agent-${agent}@example.test`]);
    await admin.query("INSERT INTO organization_members (organization_id,user_id,role,status) VALUES ($1,$2,'owner','active'),($1,$3,'agent','active')",
      [org,owner,agent]);
    await admin.query("INSERT INTO customers (id,organization_id,email,name) VALUES ($1,$2,'a-auto@example.test','A'),($3,$4,'b-auto@example.test','B')",
      [customer,org,otherCustomer,otherOrg]);
    await admin.query("INSERT INTO tickets (id,organization_id,customer_id,ticket_number,subject,status,priority,tags,updated_at) VALUES ($1,$2,$3,8101,'Billing ticket','open','normal','[]',now()),($4,$5,$6,9101,'Other tenant ticket','open','normal','[]',now()),($7,$2,$3,8102,'Idle support','open','normal','[]',now()-interval '3 hours')",
      [ticketId,org,customer,otherTicket,otherOrg,otherCustomer,idleTicket]);
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(org);
      const saved = await SupportAutomationService.save(org, owner, {
        name: "Bill high", description: null, enabled: true, trigger: "ticket.created", idleMinutes: null,
        conditions: { subjectIncludes: "Billing", onlyUnassigned: true },
        actions: [{ type: "set_priority", priority: "high" }, { type: "add_tag", tag: "billing" },
          { type: "assign_agent", userId: agent }, { type: "notify_admins", message: "Bitte prüfen" }],
      });
      assert.equal(saved.enabled, true);
      const preview = await SupportAutomationService.preview(org, ticketId, {
        name: "Bill high", enabled: true, trigger: "ticket.created", idleMinutes: null,
        conditions: { subjectIncludes: "Billing" }, actions: [{ type: "set_priority", priority: "high" }],
      });
      assert.equal(preview.matched, true);
      assert.equal(preview.dryRun, true);
      const [before] = await db.select().from(tickets).where(eq(tickets.id,ticketId));
      assert.equal(before.priority, "normal", "simulation must not mutate ticket");
      const time = new Date("2026-10-27T13:00:00Z");
      assert.equal((await SupportAutomationService.handleTicketEvent(org,ticketId,"ticket.created",time)).applied, 1);
      assert.equal((await SupportAutomationService.handleTicketEvent(org,ticketId,"ticket.created",time)).applied, 0);
      const [after] = await db.select().from(tickets).where(eq(tickets.id,ticketId));
      assert.equal(after.priority, "high");
      assert.equal(after.assignedAgentId, agent);
      assert.deepEqual(after.tags, ["billing"]);
      const runs = await SupportAutomationService.history(org);
      assert.equal(runs.length, 1);
      assert.deepEqual(runs[0].actionsApplied, ["set_priority","add_tag","assign_agent","notify_admins"]);
      const sent = await db.select().from(notifications)
        .where(and(eq(notifications.organizationId,org),eq(notifications.type,"automation.rule")));
      assert.equal(sent.length, 1);
      assert.equal(sent[0].recipientUserId, owner);
      assert.equal((await SupportAutomationService.handleTicketEvent(org,ticketId,"ticket.updated",new Date(),"automation_rules")).applied, 0);
      await assert.rejects(SupportAutomationService.preview(org,otherTicket,{
        name:"Foreign",enabled:false,trigger:"ticket.created",conditions:{},actions:[{type:"add_tag",tag:"x"}],
      }),/Ticket not found/);
      const idles = await SupportAutomationService.save(org,owner,{
        name:"Idle alert",enabled:true,trigger:"ticket.idle",idleMinutes:120,conditions:{subjectIncludes:"Idle"},
        actions:[{type:"notify_admins",message:"Ticket unbearbeitet"}],
      });
      assert.equal(idles.idleMinutes, 120);
      assert.equal((await SupportAutomationService.sweepIdle(org)).applied, 1);
      assert.equal((await SupportAutomationService.sweepIdle(org)).applied, 0);
      const count = await db.select().from(supportAutomationRuns).where(eq(supportAutomationRuns.organizationId,org));
      assert.equal(count.length,2,"idle sweep must not duplicate execution log");
      await SupportAutomationService.remove(org,saved.id);
      assert.equal((await SupportAutomationService.list(org)).length,1);
      const foreign = await db.select().from(supportAutomationRules).where(eq(supportAutomationRules.organizationId,otherOrg));
      assert.equal(foreign.length,0);
    });
    console.log("Support automation integration tests passed");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id IN ($1,$2)",[org,otherOrg]).catch(()=>undefined);
    await admin.query("DELETE FROM users WHERE id IN ($1,$2)",[owner,agent]).catch(()=>undefined);
    await admin.end();
    await closeDatabasePool();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
