import { and, eq, inArray, sql } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import { agentPresence, organizationMembers, tickets, users } from "../db/schema.js";
import { isAvailableForAutomaticRouting } from "./routingAvailability.js";
import { isAbsent, isWithinScheduledHours } from "./supportSchedulePolicy.js";
import { supportAbsences, supportSchedules } from "../db/supportScheduleSchema.js";
import { notifications } from "../db/notificationSchema.js";
import { ticketCaseEvents } from "../db/extendedCustomerExperienceSchema.js";
import { domainEventBus } from "./domainEventBus.js";
import { employeeDirectory } from "../db/employeeDirectorySchema.js";
import { supportTeams, supportTeamMembers, ticketRouting, slaEscalationSettings } from "../db/teamRoutingSchema.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class TeamRoutingService {
 static async teams(org:string){
  const [teams,members]=await Promise.all([db.select().from(supportTeams).where(eq(supportTeams.organizationId,org)),db.select().from(supportTeamMembers).where(eq(supportTeamMembers.organizationId,org))]);
  return teams.map(t=>({...t,members:members.filter(m=>m.teamId===t.id).map(m=>m.userId)}));
 }
 static async saveTeam(org:string,input:{name:string;description?:string;requiredSkills?:string[];leadUserId?:string|null;enabled?:boolean},id?:string){
  const name=typeof input.name==="string"?input.name.trim():"";
  if(!name||name.length>100)throw new Error("Invalid team name");
  const requiredSkills=Array.isArray(input.requiredSkills)?[...new Set(input.requiredSkills.filter(s=>typeof s==="string").map(s=>s.trim().toLowerCase()).filter(Boolean))].slice(0,30):[];
  if(requiredSkills.some(s=>s.length>80))throw new Error("Invalid skills");
  const lead=input.leadUserId||null;
  if(lead)await this.assertSupportMember(org,lead);
  const patch={name,description:typeof input.description==="string"?input.description.trim().slice(0,500):null,requiredSkills,leadUserId:lead,enabled:input.enabled!==false,updatedAt:new Date()};
  if(id){const [updated]=await db.update(supportTeams).set(patch).where(and(eq(supportTeams.organizationId,org),eq(supportTeams.id,id))).returning();if(!updated)throw new Error("Team not found");return updated;}
  const [created]=await db.insert(supportTeams).values({organizationId:org,...patch}).returning();return created;
 }
 static async assertSupportMember(org:string,userId:string){
  if(!UUID.test(userId))throw new Error("Invalid user ID");
  const [member]=await db.select({id:organizationMembers.id}).from(organizationMembers).where(and(eq(organizationMembers.organizationId,org),eq(organizationMembers.userId,userId),eq(organizationMembers.status,"active"),inArray(organizationMembers.role,["owner","admin","agent"]))).limit(1);
  if(!member)throw new Error("User is not an active support member");
 }
 static async setMembers(org:string,teamId:string,userIds:string[]){
  if(!Array.isArray(userIds)||userIds.length>100||userIds.some(id=>typeof id!=="string"||!UUID.test(id)))throw new Error("Invalid members");
  const [team]=await db.select({id:supportTeams.id}).from(supportTeams).where(and(eq(supportTeams.organizationId,org),eq(supportTeams.id,teamId))).limit(1);
  if(!team)throw new Error("Team not found");
  const distinct=[...new Set(userIds)];
  for(const userId of distinct)await this.assertSupportMember(org,userId);
  await withTenantTransaction(org,async tx=>{
   await tx.delete(supportTeamMembers).where(and(eq(supportTeamMembers.organizationId,org),eq(supportTeamMembers.teamId,teamId)));
   if(distinct.length)await tx.insert(supportTeamMembers).values(distinct.map(userId=>({organizationId:org,teamId,userId})));
  });
  return this.teams(org);
 }
 static async routeTicket(org:string,ticketId:string,preferredTeamId?:string,options?:{expectedAssignedUserId?:string;preferredBackupUserId?:string}){
  const [ticket]=await db.select().from(tickets).where(and(eq(tickets.organizationId,org),eq(tickets.id,ticketId))).limit(1);
  if(!ticket)throw new Error("Ticket not found");
  if(ticket.assignedAgentId && ticket.assignedAgentId !== options?.expectedAssignedUserId)return {assigned:false,reason:"already_assigned"};
  if(options?.expectedAssignedUserId && ticket.assignedAgentId !== options.expectedAssignedUserId)return {assigned:false,reason:"assignment_changed"};
  if(!["open","in_progress"].includes(ticket.status))return {assigned:false,reason:"ticket_not_open"};
  const teams=await db.select().from(supportTeams).where(and(eq(supportTeams.organizationId,org),eq(supportTeams.enabled,true)));
  const [priorTeam]=ticket.assignedAgentId?await db.select({teamId:ticketRouting.teamId}).from(ticketRouting).where(and(eq(ticketRouting.organizationId,org),eq(ticketRouting.ticketId,ticketId))).limit(1):[];
  // Existing assignments stay inside their routed team; never migrate across departments silently.
  const teamFilter=preferredTeamId||priorTeam?.teamId;
  const eligibleTeams=teamFilter?teams.filter(t=>t.id===teamFilter):teams;
  if(preferredTeamId&&!eligibleTeams.length)throw new Error("Team not found");
  const members=await db.select({teamId:supportTeamMembers.teamId,userId:supportTeamMembers.userId,role:organizationMembers.role,status:organizationMembers.status,userStatus:users.status}).from(supportTeamMembers).innerJoin(organizationMembers,and(eq(organizationMembers.organizationId,org),eq(organizationMembers.userId,supportTeamMembers.userId))).innerJoin(users,eq(users.id,supportTeamMembers.userId)).where(eq(supportTeamMembers.organizationId,org));
  const directory=await db.select().from(employeeDirectory).where(eq(employeeDirectory.organizationId,org));
  const presence=await db.select().from(agentPresence).where(eq(agentPresence.organizationId,org));
  const [schedules,absences]=await Promise.all([
    db.select().from(supportSchedules).where(eq(supportSchedules.organizationId,org)),
    db.select().from(supportAbsences).where(and(eq(supportAbsences.organizationId,org),sql`${supportAbsences.startsAt} <= now()`,sql`${supportAbsences.endsAt} > now()`)),
  ]);
  const now=new Date();
  const load=await db.select({userId:tickets.assignedAgentId,count:sql<number>`count(*)::int`}).from(tickets).where(and(eq(tickets.organizationId,org),inArray(tickets.status,["open","in_progress"]))).groupBy(tickets.assignedAgentId);
  const terms=[ticket.subject,ticket.description||"",...(Array.isArray(ticket.tags)?ticket.tags.filter((t):t is string=>typeof t==="string"):[])].join(" ").toLowerCase();
  const scored=eligibleTeams.flatMap(team=>{
   const skills=Array.isArray(team.requiredSkills)?team.requiredSkills:[];
   const teamFit=skills.filter(s=>terms.includes(s.toLowerCase())).length;
   return members.filter(m=>m.teamId===team.id&&m.status==="active"&&m.userStatus==="active"&&["owner","admin","agent"].includes(m.role)).flatMap(member=>{
    const emp=directory.find(e=>e.userId===member.userId);
    const currentPresence=presence.find(p=>p.userId===member.userId);
    const schedule=schedules.find(s=>s.userId===member.userId);
    const unavailable=isAbsent(absences.filter(a=>a.userId===member.userId),now)||!isWithinScheduledHours(schedule,now);
    if(member.userId===options?.expectedAssignedUserId || unavailable
      || (emp&&!emp.enabled) || !isAvailableForAutomaticRouting(currentPresence?.status,currentPresence?.updatedAt,now))return [];
    const personal=Array.isArray(emp?.skills)?emp.skills.filter((s):s is string=>typeof s==="string"): [];
    const match=personal.filter(s=>terms.includes(s.toLowerCase())).length;
    const count=load.find(l=>l.userId===member.userId)?.count||0;
    if(schedule?.maxOpenTickets!=null && count>=schedule.maxOpenTickets)return [];
    const backupBonus=member.userId===options?.preferredBackupUserId?1000:0;
    return [{userId:member.userId,teamId:team.id,score:teamFit*20+match*30+15-count*5+backupBonus,load:count}];
   });
  }).sort((a,b)=>b.score-a.score||a.load-b.load||a.userId.localeCompare(b.userId));
  if(!scored.length)return {assigned:false,reason:"no_available_team_member"};
  const winner=scored[0];
  const assigned=await withTenantTransaction(org,async tx=>{
   const [row]=await tx.update(tickets).set({assignedAgentId:winner.userId,updatedAt:new Date()}).where(and(eq(tickets.organizationId,org),eq(tickets.id,ticketId),options?.expectedAssignedUserId?eq(tickets.assignedAgentId,options.expectedAssignedUserId):sql`${tickets.assignedAgentId} is null`,inArray(tickets.status,["open","in_progress"]))).returning({id:tickets.id});
   if(!row)return false;
   await tx.insert(ticketRouting).values({organizationId:org,ticketId,teamId:winner.teamId,routingReason:options?.expectedAssignedUserId?"schedule_reassignment":"skills_presence_workload"}).onConflictDoUpdate({target:ticketRouting.ticketId,set:{teamId:winner.teamId,routingReason:options?.expectedAssignedUserId?"schedule_reassignment":"skills_presence_workload",updatedAt:new Date()}});
   if(options?.expectedAssignedUserId)await tx.insert(ticketCaseEvents).values({organizationId:org,ticketId,type:"assignment.schedule_reassigned",fromValue:options.expectedAssignedUserId,toValue:winner.userId,metadata:{teamId:winner.teamId}});
   await tx.insert(notifications).values({organizationId:org,recipientUserId:winner.userId,type:"ticket.assigned",severity:"info",title:`Ticket #${ticket.ticketNumber} zugewiesen`,message:ticket.subject,resourceType:"ticket",resourceId:ticketId,dedupeKey:`assignment:${ticketId}:${winner.userId}`}).onConflictDoNothing({target:[notifications.organizationId,notifications.recipientUserId,notifications.dedupeKey]});
   return true;
  });
  if(assigned)await domainEventBus.emit({type:"ticket.updated",organizationId:org,conversationId:ticket.conversationId||undefined,payload:{...ticket,assignedAgentId:winner.userId,changedFields:["assignedAgentId"],source:options?.expectedAssignedUserId?"schedule_reassignment":"auto_routing"}});
  return assigned?{assigned:true,agentId:winner.userId,teamId:winner.teamId}:{assigned:false,reason:"concurrently_assigned"};
 }
 static async escalationSettings(org:string){
  const [row]=await db.select().from(slaEscalationSettings).where(eq(slaEscalationSettings.organizationId,org)).limit(1);
  if(row)return row;
  const [saved]=await db.insert(slaEscalationSettings).values({organizationId:org}).onConflictDoNothing().returning();
  return saved||(await db.select().from(slaEscalationSettings).where(eq(slaEscalationSettings.organizationId,org)).limit(1))[0];
 }
 static async updateEscalationSettings(org:string,input:{enabled?:boolean;warningMinutes?:number;autoRaisePriority?:boolean}){
  if(input.warningMinutes!==undefined&&(!Number.isInteger(input.warningMinutes)||input.warningMinutes<1||input.warningMinutes>1440))throw new Error("Invalid warning threshold");
  await this.escalationSettings(org);
  const patch:{enabled?:boolean;warningMinutes?:number;autoRaisePriority?:boolean;updatedAt:Date}={updatedAt:new Date()};
  if(input.enabled!==undefined)patch.enabled=input.enabled===true;
  if(input.warningMinutes!==undefined)patch.warningMinutes=input.warningMinutes;
  if(input.autoRaisePriority!==undefined)patch.autoRaisePriority=input.autoRaisePriority===true;
  const [row]=await db.update(slaEscalationSettings).set(patch).where(eq(slaEscalationSettings.organizationId,org)).returning();return row;
 }
}
