import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, organizations } from "./schema.js";

export const knowledgeGaps = pgTable("knowledge_gaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  topic: text("topic").notNull(),
  summary: text("summary").notNull(),
  status: text("status").default("open").notNull(), // open | acknowledged | resolved | ignored
  occurrences: integer("occurrences").default(1).notNull(),
  sourceConversationId: uuid("source_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  knowledgeGapUnique: uniqueIndex("knowledge_gap_org_fingerprint_unique").on(table.organizationId, table.fingerprint),
  knowledgeGapStatusIdx: index("knowledge_gap_status_idx").on(table.organizationId, table.status, table.lastSeenAt),
}));

/** Tracks source observations so repeated discovery scans are idempotent. */
export const knowledgeGapSignals = pgTable("knowledge_gap_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  gapId: uuid("gap_id").references(() => knowledgeGaps.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  knowledgeGapSignalUnique: uniqueIndex("knowledge_gap_signal_unique").on(table.organizationId, table.sourceType, table.sourceId),
  knowledgeGapSignalGapIdx: index("knowledge_gap_signal_gap_idx").on(table.organizationId, table.gapId),
}));
