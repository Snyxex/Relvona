import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, organizations } from "./schema.js";

/**
 * Pseudonymous website visitor identity.
 *
 * The browser token itself is never persisted. visitorKeyHash is an HMAC of
 * the opaque client token, scoped by organization. No name, email, IP address,
 * user-agent fingerprint, or other direct identifier belongs in this table.
 */
export const anonymousVisitors = pgTable("anonymous_visitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  visitorKeyHash: text("visitor_key_hash").notNull(),
  memoryEnabled: boolean("memory_enabled").default(true).notNull(),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  visitorKeyUnique: uniqueIndex("anonymous_visitor_key_unique").on(table.organizationId, table.visitorKeyHash),
  visitorOrgIdx: index("anonymous_visitor_org_idx").on(table.organizationId, table.lastSeenAt),
}));

/** Links an otherwise normal support conversation to a pseudonymous visitor. */
export const visitorConversations = pgTable("visitor_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  visitorId: uuid("visitor_id")
    .references(() => anonymousVisitors.id, { onDelete: "cascade" })
    .notNull(),
  conversationId: uuid("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  conversationUnique: uniqueIndex("visitor_conversation_unique").on(table.organizationId, table.conversationId),
  visitorHistoryIdx: index("visitor_conversation_history_idx").on(table.organizationId, table.visitorId, table.createdAt),
}));

/**
 * Curated long-term AI memory. It stores only support-relevant summaries, not
 * entire conversations and not direct customer identity data.
 */
export const visitorMemories = pgTable("visitor_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  visitorId: uuid("visitor_id")
    .references(() => anonymousVisitors.id, { onDelete: "cascade" })
    .notNull(),
  type: text("type").notNull(), // support_issue | preference | environment | resolution | temporary
  summary: text("summary").notNull(),
  status: text("status").default("active").notNull(), // active | resolved | superseded
  sourceConversationId: uuid("source_conversation_id")
    .references(() => conversations.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").default({}).notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  visitorMemoryIdx: index("visitor_memory_idx").on(table.organizationId, table.visitorId, table.status, table.updatedAt),
}));
