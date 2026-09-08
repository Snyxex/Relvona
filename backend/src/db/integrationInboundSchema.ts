import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema.js";
import { integrationConnections } from "./integrationConnectionSchema.js";

export const integrationInboundEvents = pgTable("integration_inbound_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").notNull(),
  invocationId: text("invocation_id").notNull(),
  eventType: text("event_type").notNull(),
  externalEntityId: text("external_entity_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").default("pending").notNull(), // pending | processing | succeeded | ignored | failed
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  invocationUnique: uniqueIndex("integration_inbound_invocation_unique").on(table.organizationId, table.connectionId, table.invocationId),
  pendingIdx: index("integration_inbound_pending_idx").on(table.organizationId, table.status, table.createdAt),
}));
