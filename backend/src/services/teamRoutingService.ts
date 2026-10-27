import { and, eq, inArray, sql } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import { agentPresence, organizationMembers, tickets, users } from "../db/schema.js";
import { isAvailableForAutomaticRouting } from "./routingAvailability.js";
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
 static async routeTicket(org:string,ticketId:string,preferredTeamId?:string){
  const [ticket]=await db.select().from(tickets).where(and(eq(tickets.organizationId,org),eq(tickets.id,ticketId))).limit(1);
  if(!ticket)throw new Error("Ticket not found");
  if(ticket.assignedAgentId)return {assigned:false,reason:"already_assigned"};
  if(!["open","in_progress"].includes(ticket.status))return {assigned:false,reason:"ticket_not_open"};
  const teams=await db.select().from(supportTeams).where(and(eq(supportTeams.organizationId,org),eq(supportTeams.enabled,true)));
  const eligibleTeams=preferredTeamId?teams.filter(t=>t.id===preferredTeamId):teams;
  if(preferredTeamId&&!eligibleTeams.length)throw new Error("Team not found");
  const members=await db.select({teamId:supportTeamMembers.teamId,userId:supportTeamMembers.userId,role:organizationMembers.role,status:organizationMembers.status,userStatus:users.status}).from(supportTeamMembers).innerJoin(organizationMembers,and(eq(organizationMembers.organizationId,org),eq(organizationMembers.userId,supportTeamMembers.userId))).innerJoin(users,eq(users.id,supportTeamMembers.userId)).where(eq(supportTeamMembers.organizationId,org));
  const directory=await db.select().from(employeeDirectory).where(eq(employeeDirectory.organizationId,org));
  const presence=await db.select().from(agentPresence).where(eq(agentPresence.organizationId,org));
  const load=await db.select({userId:tickets.assignedAgentId,count:sql<number>`count(*)::int`}).from(tickets).where(and(eq(tickets.organizationId,org),inArray(tickets.status,["open","in_progress"]))).groupBy(tickets.assignedAgentId);
  const terms=[ticket.subject,ticket.description||"",...(Array.isArray(ticket.tags)?ticket.tags.filter((t):t is string=>typeof t==="string"):[])].join(" ").toLowerCase();
  const scored=eligibleTeams.flatMap(team=>{
   const skills=Array.isArray(team.requiredSkills)?team.requiredSkills:[];
   const teamFit=skills.filter(s=>terms.includes(s.toLowerCase())).length;
   return members.filter(m=>m.teamId===team.id&&m.status==="active"&&m.userStatus==="active"&&["owner","admin","agent"].includes(m.role)).flatMap(member=>{
    const emp=directory.find(e=>e.userId===member.userId);
    const currentPresence=presence.find(p=>p.userId===member.userId);
    if((emp&&!emp.enabled)||!isAvailableForAutomaticRouting(currentPresence?.status,currentPresence?.updatedAt))return [];
    const personal=Array.isArray(emp?.skills)?emp.skills.filter((s):s is string=>typeof s==="string"): [];
    const match=personal.filter(s=>terms.includes(s.toLowerCase())).length;
    const count=load.find(l=>l.userId===member.userId)?.count||0;
    return [{userId:member.userId,teamId:team.id,score:teamFit*20+match*30+15-count*5,load:count}];
   });
  }).sort((a,b)=>b.score-a.score||a.load-b.load||a.userId.localeCompare(b.userId));
  if(!scored.length)return {assigned:false,reason:"no_available_team_member"};
  const winner=scored[0];
  const assigned=await withTenantTransaction(org,async tx=>{
   const [row]=await tx.update(tickets).set({assignedAgentId:winner.userId,updatedAt:new Date()}).where(and(eq(tickets.organizationId,org),eq(tickets.id,ticketId),sql`${tickets.assignedAgentId} is null`,inArray(tickets.status,["open","in_progress"]))).returning({id:tickets.id});
   if(!row)return false;
   await tx.insert(ticketRouting).values({organizationId:org,ticketId,teamId:winner.teamId,routingReason:"skills_presence_workload"}).onConflictDoUpdate({target:ticketRouting.ticketId,set:{teamId:winner.teamId,routingReason:"skills_presence_workload",updatedAt:new Date()}});
   return true;
  });
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
