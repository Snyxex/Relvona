import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, tickets, users } from "./schema.js";
import type { AutomationAction, AutomationConditions, AutomationTrigger } from "../services/supportAutomationPolicy.js";

export const supportAutomationRules = pgTable("support_automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  trigger: text("trigger").$type<AutomationTrigger>().notNull(),
  idleMinutes: integer("idle_minutes"),
  conditions: jsonb("conditions").$type<AutomationConditions>().notNull().default({}),
  actions: jsonb("actions").$type<AutomationAction[]>().notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  orgTriggerIdx: index("support_automation_rule_trigger_idx").on(t.organizationId, t.trigger, t.enabled),
}));

export const supportAutomationRuns = pgTable("support_automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id").notNull().references(() => supportAutomationRules.id, { onDelete: "cascade" }),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  trigger: text("trigger").notNull(),
  actionsApplied: jsonb("actions_applied").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  uniqueRun: uniqueIndex("support_automation_run_unique").on(t.ruleId, t.ticketId, t.eventKey),
  orgRecentIdx: index("support_automation_run_org_recent_idx").on(t.organizationId, t.createdAt),
}));
