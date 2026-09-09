import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, documentChunks, knowledgeBases, knowledgeSources, organizations } from "./schema.js";

export const knowledgeGaps = pgTable("knowledge_gaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  topic: text("topic").notNull(),
  summary: text("summary").notNull(),
  reason: text("reason").default("NO_RELEVANT_SOURCE").notNull(),
  severity: text("severity").default("MEDIUM").notNull(),
  impactScore: integer("impact_score").default(0).notNull(),
  language: text("language"),
  status: text("status").default("OPEN").notNull(), // OPEN | REVIEWING | CONTENT_DRAFTED | RESOLVED | IGNORED
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
  knowledgeGapImpactIdx: index("knowledge_gap_impact_idx").on(table.organizationId, table.impactScore, table.lastSeenAt),
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

/** Intelligence metadata is kept separate from ingestion state to avoid overloading knowledge_sources.status. */
export const knowledgeSourceIntelligence = pgTable("knowledge_source_intelligence", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  sourceId: uuid("source_id").references(() => knowledgeSources.id, { onDelete: "cascade" }).notNull(),
  publicationStatus: text("publication_status").default("PUBLISHED").notNull(), // DRAFT | PUBLISHED | ARCHIVED
  health: text("health").default("HEALTHY").notNull(),
  category: text("category"),
  language: text("language"),
  tags: jsonb("tags").default([]).notNull(),
  priority: text("priority").default("NORMAL").notNull(),
  recrawlEnabled: boolean("recrawl_enabled").default(false).notNull(),
  recrawlIntervalMinutes: integer("recrawl_interval_minutes"),
  nextCrawlAt: timestamp("next_crawl_at"),
  lastSuccessfulCrawlAt: timestamp("last_successful_crawl_at"),
  lastFailureAt: timestamp("last_failure_at"),
  lastFailureCategory: text("last_failure_category"),
  retrievalCount: integer("retrieval_count").default(0).notNull(),
  answerUsageCount: integer("answer_usage_count").default(0).notNull(),
  lastRetrievedAt: timestamp("last_retrieved_at"),
  lastUsedInAnswerAt: timestamp("last_used_in_answer_at"),
  lastHealthCheckAt: timestamp("last_health_check_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sourceUnique: uniqueIndex("knowledge_source_intelligence_source_unique").on(table.sourceId),
  orgHealthIdx: index("knowledge_source_intelligence_health_idx").on(table.organizationId, table.health, table.updatedAt),
  orgPublicationIdx: index("knowledge_source_intelligence_publication_idx").on(table.organizationId, table.publicationStatus, table.updatedAt),
  recrawlIdx: index("knowledge_source_intelligence_recrawl_idx").on(table.organizationId, table.recrawlEnabled, table.nextCrawlAt),
}));

export const knowledgeRetrievalEvents = pgTable("knowledge_retrieval_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  sourceId: uuid("source_id").references(() => knowledgeSources.id, { onDelete: "cascade" }).notNull(),
  chunkId: uuid("chunk_id").references(() => documentChunks.id, { onDelete: "cascade" }),
  revision: integer("revision"),
  relevanceScore: real("relevance_score"),
  usedInFinalAnswer: boolean("used_in_final_answer").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgSourceIdx: index("knowledge_retrieval_org_source_idx").on(table.organizationId, table.sourceId, table.createdAt),
  orgConversationIdx: index("knowledge_retrieval_org_conversation_idx").on(table.organizationId, table.conversationId, table.createdAt),
}));

export const knowledgeFaqDrafts = pgTable("knowledge_faq_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  knowledgeBaseId: uuid("knowledge_base_id").references(() => knowledgeBases.id, { onDelete: "cascade" }).notNull(),
  gapId: uuid("gap_id").references(() => knowledgeGaps.id, { onDelete: "set null" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  language: text("language"),
  category: text("category"),
  tags: jsonb("tags").default([]).notNull(),
  confidence: real("confidence"),
  evidence: jsonb("evidence").default([]).notNull(),
  reviewStatus: text("review_status").default("PENDING_REVIEW").notNull(), // PENDING_REVIEW | APPROVED | REJECTED | PUBLISHED
  publishedSourceId: uuid("published_source_id").references(() => knowledgeSources.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id"),
  reviewedByUserId: uuid("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgReviewIdx: index("knowledge_faq_drafts_review_idx").on(table.organizationId, table.reviewStatus, table.updatedAt),
  gapIdx: index("knowledge_faq_drafts_gap_idx").on(table.organizationId, table.gapId),
}));
