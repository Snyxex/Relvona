import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema.js";

export type IntegrationProvider = "hubspot" | "zendesk";

export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").$type<IntegrationProvider>().notNull(),
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  status: text("status").default("untested").notNull(), // untested | connected | error
  lastTestedAt: timestamp("last_tested_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  integrationConnectionUnique: uniqueIndex("integration_connection_org_provider_name_unique").on(table.organizationId, table.provider, table.name),
  integrationConnectionOrgIdx: index("integration_connection_org_idx").on(table.organizationId, table.provider, table.enabled),
}));
