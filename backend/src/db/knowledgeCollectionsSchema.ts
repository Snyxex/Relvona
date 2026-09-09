import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assistants, knowledgeSources, organizations } from "./schema.js";

export const knowledgeCollections = pgTable("knowledge_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgNameUnique: uniqueIndex("knowledge_collections_org_name_unique").on(table.organizationId, table.name),
  orgUpdatedIdx: index("knowledge_collections_org_updated_idx").on(table.organizationId, table.updatedAt),
}));

export const sourceKnowledgeCollections = pgTable("source_knowledge_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  sourceId: uuid("source_id").references(() => knowledgeSources.id, { onDelete: "cascade" }).notNull(),
  collectionId: uuid("collection_id").references(() => knowledgeCollections.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  sourceCollectionUnique: uniqueIndex("source_knowledge_collections_unique").on(table.sourceId, table.collectionId),
  orgCollectionIdx: index("source_knowledge_collections_org_collection_idx").on(table.organizationId, table.collectionId),
  orgSourceIdx: index("source_knowledge_collections_org_source_idx").on(table.organizationId, table.sourceId),
}));

export const assistantKnowledgeCollections = pgTable("assistant_knowledge_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  assistantId: uuid("assistant_id").references(() => assistants.id, { onDelete: "cascade" }).notNull(),
  collectionId: uuid("collection_id").references(() => knowledgeCollections.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  assistantCollectionUnique: uniqueIndex("assistant_knowledge_collections_unique").on(table.assistantId, table.collectionId),
  orgAssistantIdx: index("assistant_knowledge_collections_org_assistant_idx").on(table.organizationId, table.assistantId),
  orgCollectionIdx: index("assistant_knowledge_collections_org_collection_idx").on(table.organizationId, table.collectionId),
}));
