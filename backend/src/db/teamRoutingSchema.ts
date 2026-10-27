import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users, tickets } from "./schema.js";
export const supportTeams = pgTable("support_teams", {
 id: uuid("id").primaryKey().defaultRandom(),
 organizationId: uuid("organization_id").notNull().references(()=>organizations.id,{onDelete:"cascade"}),
 name: text("name").notNull(), description: text("description"),
 requiredSkills: jsonb("required_skills").$type<string[]>().default([]).notNull(),
 enabled: boolean("enabled").default(true).notNull(),
 leadUserId: uuid("lead_user_id").references(()=>users.id,{onDelete:"set null"}),
 createdAt: timestamp("created_at").defaultNow().notNull(),updatedAt: timestamp("updated_at").defaultNow().notNull()
},t=>({nameUnique:uniqueIndex("support_team_org_name_unique").on(t.organizationId,t.name)}));
export const supportTeamMembers = pgTable("support_team_members",{
 id: uuid("id").primaryKey().defaultRandom(),
 organizationId:uuid("organization_id").notNull().references(()=>organizations.id,{onDelete:"cascade"}),
 teamId:uuid("team_id").notNull().references(()=>supportTeams.id,{onDelete:"cascade"}),
 userId:uuid("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}),
 createdAt:timestamp("created_at").defaultNow().notNull()
},t=>({uniqueMember:uniqueIndex("support_team_member_unique").on(t.teamId,t.userId),orgIdx:index("support_team_member_org_idx").on(t.organizationId,t.teamId)}));
export const ticketRouting = pgTable("ticket_routing",{
 id:uuid("id").primaryKey().defaultRandom(),organizationId:uuid("organization_id").notNull().references(()=>organizations.id,{onDelete:"cascade"}),
 ticketId:uuid("ticket_id").notNull().references(()=>tickets.id,{onDelete:"cascade"}).unique(),
 teamId:uuid("team_id").references(()=>supportTeams.id,{onDelete:"set null"}),
 routingReason:text("routing_reason"),createdAt:timestamp("created_at").defaultNow().notNull(),updatedAt:timestamp("updated_at").defaultNow().notNull()
},t=>({orgIdx:index("ticket_routing_org_idx").on(t.organizationId,t.teamId)}));
export const slaEscalationSettings=pgTable("sla_escalation_settings",{
 id:uuid("id").primaryKey().defaultRandom(),organizationId:uuid("organization_id").notNull().references(()=>organizations.id,{onDelete:"cascade"}).unique(),
 enabled:boolean("enabled").default(true).notNull(),warningMinutes:integer("warning_minutes").default(15).notNull(),
 autoRaisePriority:boolean("auto_raise_priority").default(false).notNull(),
 updatedAt:timestamp("updated_at").defaultNow().notNull()
});
