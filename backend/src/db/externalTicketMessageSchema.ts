import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { integrationConnections } from "./integrationConnectionSchema.js";
import { organizations, tickets } from "./schema.js";

export const externalActors = pgTable("external_actors", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  role: text("role").default("unknown").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  externalActorUnique: uniqueIndex("external_actor_org_connection_external_unique").on(table.organizationId, table.connectionId, table.externalId),
  externalActorLookupIdx: index("external_actor_lookup_idx").on(table.organizationId, table.connectionId, table.provider),
}));

export const externalTicketMessages = pgTable("external_ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(),
  connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "cascade" }).notNull(),
  actorId: uuid("actor_id").references(() => externalActors.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  externalMessageId: text("external_message_id").notNull(),
  direction: text("direction").default("inbound").notNull(),
  visibility: text("visibility").default("public").notNull(),
  content: text("content").notNull(),
  providerCreatedAt: timestamp("provider_created_at"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  externalMessageUnique: uniqueIndex("external_ticket_message_org_connection_external_unique").on(table.organizationId, table.connectionId, table.externalMessageId),
  externalMessageTicketIdx: index("external_ticket_message_ticket_idx").on(table.organizationId, table.ticketId, table.createdAt),
}));
