import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { assistants, organizations, users } from "./schema.js";

export const assistantVersions = pgTable("assistant_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  assistantId: uuid("assistant_id").references(() => assistants.id, { onDelete: "cascade" }).notNull(),
  version: integer("version").notNull(),
  label: text("label"),
  status: text("status").default("published").notNull(), // published | active | archived
  snapshot: jsonb("snapshot").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  activatedAt: timestamp("activated_at"),
}, (table) => ({
  assistantVersionUnique: uniqueIndex("assistant_version_unique").on(table.assistantId, table.version),
  assistantActiveVersionUnique: uniqueIndex("assistant_active_version_unique").on(table.assistantId).where(sql`${table.status} = 'active'`),
  assistantVersionListIdx: index("assistant_version_list_idx").on(table.organizationId, table.assistantId, table.createdAt),
}));
