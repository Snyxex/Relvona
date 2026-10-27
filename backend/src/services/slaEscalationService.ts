import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import { organizationMembers, tickets } from "../db/schema.js";
import { ticketCaseMetadata } from "../db/extendedCustomerExperienceSchema.js";
import { notifications } from "../db/notificationSchema.js";
import { supportTeams, supportTeamMembers, ticketRouting } from "../db/teamRoutingSchema.js";
import { TeamRoutingService } from "./teamRoutingService.js";
export class SlaEscalationService {
 static async sweepOrganization(org:string){
  const settings=await TeamRoutingService.escalationSettings(org);
  if(!settings.enabled)return {warnings:0,breaches:0};
  const now=new Date(), soon=new Date(now.getTime()+settings.warningMinutes*60_000);
  const cases=await db.select({caseRow:ticketCaseMetadata,ticket:tickets}).from(ticketCaseMetadata)
   .innerJoin(tickets,and(eq(tickets.id,ticketCaseMetadata.ticketId),eq(tickets.organizationId,org)))
   .where(and(eq(ticketCaseMetadata.organizationId,org),inArray(tickets.status,["open","in_progress"]),or(and(isNull(ticketCaseMetadata.firstRespondedAt),lte(ticketCaseMetadata.firstResponseDueAt,soon)),and(isNull(ticketCaseMetadata.resolvedAt),lte(ticketCaseMetadata.resolutionDueAt,soon))))).limit(300);
  const leads=await db.select({userId:supportTeams.leadUserId,ticketId:ticketRouting.ticketId}).from(ticketRouting).innerJoin(supportTeams,and(eq(supportTeams.id,ticketRouting.teamId),eq(supportTeams.organizationId,org))).where(eq(ticketRouting.organizationId,org));
  const admins=await db.select({userId:organizationMembers.userId}).from(organizationMembers).where(and(eq(organizationMembers.organizationId,org),eq(organizationMembers.status,"active"),inArray(organizationMembers.role,["owner","admin"])));
  let warnings=0,breaches=0;
  for(const {caseRow,ticket} of cases){
   const checks=[{kind:"first_response",due:caseRow.firstResponseDueAt,done:Boolean(caseRow.firstRespondedAt)},{kind:"resolution",due:caseRow.resolutionDueAt,done:Boolean(caseRow.resolvedAt)}];
   for(const check of checks){
    const due=check.due;
    if(check.done||!due||due>soon)continue;
    const breached=due<=now;
    const category=breached?"breached":"warning";
    const lead=leads.find(l=>l.ticketId===ticket.id)?.userId;
    const recipients=[...new Set([ticket.assignedAgentId,lead,...(breached?admins.map(a=>a.userId):[])].filter((s):s is string=>Boolean(s)))];
    if(!recipients.length)recipients.push(...admins.map(a=>a.userId));
    await withTenantTransaction(org,async tx=>{
     for(const recipientUserId of recipients){
      const [created]=await tx.insert(notifications).values({organizationId:org,recipientUserId,type:`sla.${category}`,severity:breached?"warning":"info",title:breached?"SLA überschritten":"SLA läuft bald ab",message:`Ticket #${ticket.ticketNumber}: ${check.kind==="first_response"?"Erstantwort":"Lösung"} – ${ticket.subject}`,resourceType:"ticket",resourceId:ticket.id,dedupeKey:`sla:${ticket.id}:${check.kind}:${category}:${due.toISOString()}`}).onConflictDoNothing({target:[notifications.organizationId,notifications.recipientUserId,notifications.dedupeKey]}).returning({id:notifications.id});
      if(created){if(breached)breaches++;else warnings++;}
     }

    });
   }
  }
  return {warnings,breaches};
 }
}
