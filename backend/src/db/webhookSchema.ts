import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema.js";

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  eventTypes: jsonb("event_types").$type<string[]>().default([]).notNull(),
  encryptedSecret: text("encrypted_secret").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  webhookSubscriptionOrgIdx: index("webhook_subscription_org_idx").on(table.organizationId, table.enabled),
}));

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  webhookEventOrgIdx: index("webhook_event_org_idx").on(table.organizationId, table.createdAt),
}));

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  subscriptionId: uuid("subscription_id").references(() => webhookSubscriptions.id, { onDelete: "cascade" }).notNull(),
  eventId: uuid("event_id").references(() => webhookEvents.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("pending").notNull(), // pending | delivering | delivered | failed
  attempts: integer("attempts").default(0).notNull(),
  nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  deliveredAt: timestamp("delivered_at"),
  responseStatus: integer("response_status"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  webhookDeliveryUnique: uniqueIndex("webhook_delivery_subscription_event_unique").on(table.subscriptionId, table.eventId),
  webhookDeliveryPendingIdx: index("webhook_delivery_pending_idx").on(table.organizationId, table.status, table.nextAttemptAt),
}));
