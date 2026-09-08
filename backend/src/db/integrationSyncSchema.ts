import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema.js";
import { integrationConnections } from "./integrationConnectionSchema.js";

export const integrationSyncRules = pgTable("integration_sync_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "cascade" }).notNull(),
  eventType: text("event_type").notNull(),
  action: text("action").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ruleUnique: uniqueIndex("integration_sync_rule_unique").on(table.organizationId, table.connectionId, table.eventType, table.action),
  ruleOrgEventIdx: index("integration_sync_rule_org_event_idx").on(table.organizationId, table.eventType, table.enabled),
}));

export const integrationSyncExecutions = pgTable("integration_sync_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  ruleId: uuid("rule_id").references(() => integrationSyncRules.id, { onDelete: "cascade" }).notNull(),
  eventKey: text("event_key").notNull(),
  entityId: text("entity_id").notNull(),
  status: text("status").default("pending").notNull(),
  externalId: text("external_id"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  executionUnique: uniqueIndex("integration_sync_execution_rule_event_unique").on(table.ruleId, table.eventKey),
  executionOrgIdx: index("integration_sync_execution_org_idx").on(table.organizationId, table.createdAt),
}));
