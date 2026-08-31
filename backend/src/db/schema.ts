import { pgTable, text, timestamp, uuid, integer, jsonb, boolean, vector } from "drizzle-orm/pg-core";

// Workspaces / Businesses
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().unique(),
  aiModel: text("ai_model").default("openai").notNull(), // 'openai' | 'nvidia'
  systemPrompt: text("system_prompt").default("You are a helpful, professional AI customer support assistant."),
  languageSupport: text("language_support").default("auto"), // 'auto', 'en', 'es', 'fr', 'de', etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Knowledge Base Sources (FAQs, Uploaded PDFs, Crawled Websites)
export const knowledgeSources = pgTable("knowledge_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(), // 'faq' | 'pdf' | 'website'
  sourceUrl: text("source_url"),
  status: text("status").default("completed").notNull(), // 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: integer("chunk_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Embeddings / Vectors table for RAG
export const documentEmbeddings = pgTable("document_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id").references(() => knowledgeSources.id, { onDelete: "cascade" }).notNull(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"), // e.g. page number, URL anchor, section title
  embedding: vector("embedding", { dimensions: 1536 }), // OpenAI text-embedding-3-small dimension (1536)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tickets / Conversations
export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  subject: text("subject"),
  status: text("status").default("open").notNull(), // 'open' | 'assigned' | 'resolved' | 'closed'
  priority: text("priority").default("medium").notNull(), // 'low' | 'medium' | 'high' | 'urgent'
  handOffRequested: boolean("handoff_requested").default(false).notNull(),
  assignedAgent: text("assigned_agent"),
  sentiment: text("sentiment").default("neutral"), // 'positive' | 'neutral' | 'negative'
  summary: text("summary"),
  detectedLanguage: text("detected_language").default("en"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Messages in tickets/chats
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(),
  senderType: text("sender_type").notNull(), // 'customer' | 'ai' | 'agent'
  senderName: text("sender_name"),
  content: text("content").notNull(),
  suggestedReply: text("suggested_reply"), // AI suggested response for human agents
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
