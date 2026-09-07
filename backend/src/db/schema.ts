import { pgTable, text, timestamp, uuid, integer, jsonb, boolean, vector, real, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 1. Organizations (Tenants)
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  plan: text("plan").default("pro").notNull(),
  status: text("status").default("active").notNull(),
  // Legacy column retained for a safe migration; newly issued keys are hashed
  // in api_keys and never stored here.
  apiKey: text("api_key").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 2. Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  preferredLanguage: text("preferred_language").default("de").notNull(),
  systemRole: text("system_role").default("user").notNull(), // 'superadmin' | 'user'
  status: text("status").default("active").notNull(),
  tokenVersion: integer("token_version").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 3. Organization Members (Junction with Role)
export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: text("role").default("agent").notNull(), // 'owner' | 'admin' | 'agent' | 'viewer'
  status: text("status").default("active").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgUserIdx: uniqueIndex("org_user_unique").on(table.organizationId, table.userId),
}));

// A verified dashboard hostname is an authentication boundary, not display
// metadata. A host can belong to exactly one organization.
export const organizationDashboardDomains = pgTable("organization_dashboard_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  domain: text("domain").notNull().unique(),
  verificationToken: text("verification_token").notNull().unique(),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({ dashboardDomainOrgIdx: index("dashboard_domain_org_idx").on(table.organizationId) }));

// 4. API Keys
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  name: text("name").notNull(),
  scopes: jsonb("scopes").default(["*"]).notNull(),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ keyPrefixIdx: uniqueIndex("api_key_prefix_unique").on(table.keyPrefix) }));

// 5. Customers (End-users seeking support)
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  email: text("email"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  externalId: text("external_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgCustomerIdx: index("org_customer_idx").on(table.organizationId, table.email),
}));

// 6. Assistants (AI Support Agents)
export const assistants = pgTable("assistants", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").default("Support AI").notNull(),
  avatarUrl: text("avatar_url"),
  systemPrompt: text("system_prompt").default("Du bist ein KI-Support-Assistent für {organization_name}. Antworte präzise, hilfreich und auf Deutsch, es sei denn, der Nutzer schreibt in einer anderen Sprache. Nutze nur bereitgestellte Kontext-Informationen aus der Wissensdatenbank. Bei keiner passenden Antwort antworte exakt: \"Ich habe dazu keine Informationen. Möchten Sie, dass wir ein Ticket erstellen?\". Maximal 3 Sätze, außer technische Details erfordern mehr. Keine Floskeln oder Entschuldigungen. Stelle bei Mehrdeutigkeit höchstens eine Rückfrage. Nutze Aufzählungen nur bei mehreren Schritten oder Optionen und kein Markdown außer bei Code oder technischen Begriffen. Biete bei Frustration, komplexen technischen Problemen oder wiederholten Fragen menschlichen Support an.").notNull(),
  modelProvider: text("model_provider").default("openai").notNull(), // 'openai' | 'anthropic' | 'google' | 'nvidia' | 'local'
  modelName: text("model_name").default("gpt-4o-mini").notNull(),
  apiKey: text("api_key"), // Custom API Key override
  baseUrl: text("base_url"), // Custom Base URL for Local/Ollama/LocalAI endpoints (e.g. http://localhost:11434/v1)
  embeddingProvider: text("embedding_provider").default("openai").notNull(), // 'openai' | 'google' | 'nvidia' | 'local'
  embeddingModel: text("embedding_model").default("text-embedding-3-small"),
  embeddingApiKey: text("embedding_api_key"),
  embeddingBaseUrl: text("embedding_base_url"),
  temperature: real("temperature").default(0.2).notNull(),
  handoffEnabled: boolean("handoff_enabled").default(true).notNull(),
  handoffKeywords: jsonb("handoff_keywords").default(["human", "agent", "representative", "support person", "speak to someone", "operator"]),
  primaryColor: text("primary_color").default("#3B82F6").notNull(),
  welcomeMessage: text("welcome_message").default("Hello! How can I help you today?").notNull(),
  // This identifies a browser integration; it is intentionally distinct from the
  // organization API key, which must never be embedded in a customer website.
  widgetApiKey: text("widget_api_key").unique(),
  widgetAllowedOrigins: jsonb("widget_allowed_origins").default([]).notNull(),
  chatPageEnabled: boolean("chat_page_enabled").default(false).notNull(),
  widgetSettings: jsonb("widget_settings").default({}).notNull(),
  modelProfiles: jsonb("model_profiles").default([]).notNull(),
  activeModelProfileId: text("active_model_profile_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 7. Knowledge Bases
export const knowledgeBases = pgTable("knowledge_bases", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 8. Knowledge Sources (PDFs, FAQs, Websites, Manual Text)
export const knowledgeSources = pgTable("knowledge_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  knowledgeBaseId: uuid("knowledge_base_id").references(() => knowledgeBases.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(), // 'faq' | 'document' | 'pdf' | 'website'
  sourceUrl: text("source_url"),
  filePath: text("file_path"),
  status: text("status").default("pending").notNull(), // 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: integer("chunk_count").default(0).notNull(),
  securityStatus: text("security_status").default("SAFE").notNull(), // 'SAFE' | 'SUSPICIOUS' | 'QUARANTINED'
  errorMessage: text("error_message"),
  contentHash: text("content_hash"),
  metadata: jsonb("metadata"),
  lastCrawledAt: timestamp("last_crawled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgKbIdx: index("org_kb_source_idx").on(table.organizationId, table.knowledgeBaseId),
}));

// Durable input and execution state; payloads are never returned in source lists.
export const knowledgeIngestionJobs = pgTable("knowledge_ingestion_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  sourceId: uuid("source_id").references(() => knowledgeSources.id, { onDelete: "cascade" }).notNull().unique(),
  payload: jsonb("payload").notNull(),
  revision: integer("revision").default(1).notNull(),
  status: text("status").default("queued").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until"),
  nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({ pendingIdx: index("ingestion_pending_idx").on(table.organizationId, table.status, table.nextAttemptAt) }));

// 9. Document Chunks & Embeddings (pgvector)
export const documentChunks = pgTable("document_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  knowledgeBaseId: uuid("knowledge_base_id").references(() => knowledgeBases.id, { onDelete: "cascade" }).notNull(),
  sourceId: uuid("source_id").references(() => knowledgeSources.id, { onDelete: "cascade" }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"), // e.g. page number, header, section
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgKbChunkIdx: index("org_kb_chunk_idx").on(table.organizationId, table.knowledgeBaseId),
}));

// 10. Websites (Tracked Crawls)
export const websites = pgTable("websites", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  knowledgeBaseId: uuid("knowledge_base_id").references(() => knowledgeBases.id, { onDelete: "cascade" }).notNull(),
  rootUrl: text("root_url").notNull(),
  maxDepth: integer("max_depth").default(2).notNull(),
  maxPages: integer("max_pages").default(50).notNull(),
  crawlStatus: text("crawl_status").default("idle").notNull(), // 'idle' | 'crawling' | 'completed' | 'failed'
  lastCrawledAt: timestamp("last_crawled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 11. Website Pages
export const websitePages = pgTable("website_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  websiteId: uuid("website_id").references(() => websites.id, { onDelete: "cascade" }).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  title: text("title"),
  contentHash: text("content_hash"),
  status: text("status").default("completed").notNull(),
  chunkCount: integer("chunk_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 12. Conversations
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  assistantId: uuid("assistant_id").references(() => assistants.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }).notNull(),
  state: text("state").default("AI_ACTIVE").notNull(), // 'AI_ACTIVE' | 'WAITING_FOR_AGENT' | 'AGENT_ACTIVE' | 'RESOLVED'
  assignedAgentId: uuid("assigned_agent_id").references(() => users.id, { onDelete: "set null" }),
  assignedTeamId: uuid("assigned_team_id"), // reserved for future team routing; never grants access
  priority: text("priority").default("NORMAL").notNull(),
  detectedLanguage: text("detected_language").default("en").notNull(),
  sentiment: text("sentiment").default("neutral"), // 'positive' | 'neutral' | 'negative'
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgStateIdx: index("org_state_idx").on(table.organizationId, table.state),
  inboxIdx: index("conversation_inbox_idx").on(table.organizationId, table.state, table.priority, table.updatedAt),
}));

// Durable operational events. Unlike analytics, these records form the agent-visible
// conversation timeline and are retained for auditability.
export const conversationActivities = pgTable("conversation_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ timelineIdx: index("conversation_timeline_idx").on(table.organizationId, table.conversationId, table.createdAt) }));

export const conversationTags = pgTable("conversation_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  color: text("color").default("slate").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ tagNameUnique: uniqueIndex("conversation_tag_name_unique").on(table.organizationId, table.name) }));

export const conversationTagLinks = pgTable("conversation_tag_links", {
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  tagId: uuid("tag_id").references(() => conversationTags.id, { onDelete: "cascade" }).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ conversationTagUnique: uniqueIndex("conversation_tag_unique").on(table.conversationId, table.tagId), tagFilterIdx: index("conversation_tag_filter_idx").on(table.organizationId, table.tagId) }));

export const agentPresence = pgTable("agent_presence", {
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("OFFLINE").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({ agentPresenceUnique: uniqueIndex("agent_presence_unique").on(table.organizationId, table.userId) }));

// 13. Conversation Messages
export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  senderType: text("sender_type").notNull(), // 'customer' | 'ai' | 'agent' | 'system' | 'internal_note'
  senderId: text("sender_id"),
  senderName: text("sender_name"),
  content: text("content").notNull(),
  suggestedReply: text("suggested_reply"),
  confidenceScore: real("confidence_score"),
  retrievedChunkIds: jsonb("retrieved_chunk_ids"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  convMsgIdx: index("conv_msg_idx").on(table.conversationId, table.createdAt),
}));

// Customer feedback for AI answers, used by tenant operators to improve sources.
export const messageFeedback = pgTable("message_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  messageId: uuid("message_id").references(() => conversationMessages.id, { onDelete: "cascade" }).notNull(),
  rating: integer("rating").notNull(), // 1 = helpful, -1 = not helpful
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  feedbackMessageIdx: index("feedback_message_idx").on(table.organizationId, table.messageId),
  feedbackMessageUnique: uniqueIndex("feedback_message_unique").on(table.organizationId, table.conversationId, table.messageId),
}));

// 14. Support Tickets
export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketNumber: integer("ticket_number").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }).notNull(),
  assignedAgentId: uuid("assigned_agent_id").references(() => users.id, { onDelete: "set null" }),
  subject: text("subject").notNull(),
  description: text("description"),
  status: text("status").default("open").notNull(), // 'open' | 'pending' | 'in_progress' | 'resolved' | 'closed'
  priority: text("priority").default("normal").notNull(), // 'low' | 'normal' | 'high' | 'urgent'
  source: text("source").default("manual").notNull(), // 'manual' | 'ai_escalation'
  tags: jsonb("tags").default([]),
  githubIssueNumber: integer("github_issue_number"),
  githubIssueUrl: text("github_issue_url"),
  githubIssueError: text("github_issue_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }, (table) => ({
    orgTicketIdx: index("org_ticket_idx").on(table.organizationId, table.status),
    // One active AI escalation per conversation. Manual tickets remain
    // independent and resolved escalations do not block a later handoff.
    openConversationTicketUnique: uniqueIndex("open_conversation_ticket_unique")
      .on(table.organizationId, table.conversationId)
      .where(sql`${table.source} = 'ai_escalation' AND ${table.conversationId} IS NOT NULL AND ${table.status} NOT IN ('resolved', 'closed')`),
  }));

// 15. Ticket Comments
export const ticketComments = pgTable("ticket_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 16. Analytics Events
export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  eventType: text("event_type").notNull(), // 'conversation_created', 'ai_resolved', 'handoff_requested', 'ticket_created', etc.
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgEventIdx: index("org_event_idx").on(table.organizationId, table.eventType, table.createdAt),
}));

// 17. Persistent Audit Logs (Security & Compliance Tracking)
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g. 'organization.update', 'ai.configure', 'api_key.regenerate', 'document.delete'
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  auditOrgIdx: index("audit_org_idx").on(table.organizationId, table.action, table.createdAt),
}));

// 18. Per-tenant operational settings. Secrets are AES-256-GCM encrypted before persistence.
export const organizationSettings = pgTable("organization_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull().unique(),
  primaryModel: text("primary_model").default("gpt-4o-mini").notNull(),
  fallbackModel: text("fallback_model").default("gpt-4o-mini").notNull(),
  simpleModel: text("simple_model").default("gpt-4o-mini").notNull(),
  temperature: real("temperature").default(0.2).notNull(),
  maxTokens: integer("max_tokens").default(500).notNull(),
  dailyTokenBudget: integer("daily_token_budget").default(100000).notNull(),
  widgetRequestsPerMinute: integer("widget_requests_per_minute").default(120).notNull(),
  openaiKeyEncrypted: text("openai_key_encrypted"),
  nvidiaKeyEncrypted: text("nvidia_key_encrypted"),
  costAlertThreshold: real("cost_alert_threshold").default(50).notNull(),
  sessionTimeout: integer("session_timeout").default(60).notNull(),
  apiKeyExpiryDays: integer("api_key_expiry_days").default(90).notNull(),
  ipWhitelist: jsonb("ip_whitelist").default([]),
  supportEmail: text("support_email"),
  businessHours: jsonb("business_hours").default({}),
  primaryLanguage: text("primary_language").default("de").notNull(),
  fallbackLanguages: jsonb("fallback_languages").default(["en"]),
  logoUrl: text("logo_url"),
  // The token is tenant scoped and encrypted with the platform encryption key.
  // Only automatic AI escalations are exported to the configured repository.
  githubIssuesEnabled: boolean("github_issues_enabled").default(false).notNull(),
  githubRepository: text("github_repository"),
  githubTokenEncrypted: text("github_token_encrypted"),
  activeDirectoryEnabled: boolean("active_directory_enabled").default(false).notNull(),
  activeDirectoryUrl: text("active_directory_url"),
  activeDirectoryBaseDn: text("active_directory_base_dn"),
  activeDirectoryBindDn: text("active_directory_bind_dn"),
  activeDirectoryBindPasswordEncrypted: text("active_directory_bind_password_encrypted"),
  localLoginEnabled: boolean("local_login_enabled").default(true).notNull(),
  invitationEnabled: boolean("invitation_enabled").default(true).notNull(),
  ssoEnabled: boolean("sso_enabled").default(false).notNull(),
  entraTenantId: text("entra_tenant_id"),
  entraClientId: text("entra_client_id"),
  entraClientSecretEncrypted: text("entra_client_secret_encrypted"),
  allowedDomains: jsonb("allowed_domains").default([]).notNull(),
  autoJoinEnabled: boolean("auto_join_enabled").default(false).notNull(),
  defaultAutoJoinRole: text("default_auto_join_role").default("agent").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Better Auth owns credentials and server-side sessions. The existing users
// table remains the single identity table so every business foreign key keeps
// its stable UUID during the migration.
export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), token: text("token").notNull().unique(), expiresAt: timestamp("expires_at").notNull(), ipAddress: text("ip_address"), userAgent: text("user_agent"), createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({ authSessionUserIdx: index("auth_session_user_idx").on(table.userId, table.expiresAt) }));

export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(), issuer: text("issuer").notNull(), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"), accessTokenExpiresAt: timestamp("access_token_expires_at"), refreshTokenExpiresAt: timestamp("refresh_token_expires_at"), scope: text("scope"), password: text("password"), createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({ authAccountProviderUnique: uniqueIndex("auth_account_provider_unique").on(table.providerId, table.accountId), authAccountUserIdx: index("auth_account_user_idx").on(table.userId) }));

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: timestamp("expires_at").notNull(), createdAt: timestamp("created_at").defaultNow(), updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ authVerificationIdentifierIdx: index("auth_verification_identifier_idx").on(table.identifier, table.expiresAt) }));

export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(), email: text("email").notNull(), role: text("role").notNull(), tokenHash: text("token_hash").notNull().unique(), invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }), expiresAt: timestamp("expires_at").notNull(), acceptedAt: timestamp("accepted_at"), revokedAt: timestamp("revoked_at"), createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({ orgInviteIdx: index("org_invitation_idx").on(table.organizationId, table.email, table.expiresAt) }));

export const platformSupportSessions = pgTable("platform_support_sessions", {
  id: uuid("id").primaryKey().defaultRandom(), platformAdminUserId: uuid("platform_admin_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(), reason: text("reason").notNull(), startedAt: timestamp("started_at").defaultNow().notNull(), expiresAt: timestamp("expires_at").notNull(), endedAt: timestamp("ended_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ supportSessionIdx: index("support_session_idx").on(table.platformAdminUserId, table.organizationId, table.expiresAt) }));

export const ssoLoginStates = pgTable("sso_login_states", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(), stateHash: text("state_hash").notNull().unique(), nonce: text("nonce").notNull(), expiresAt: timestamp("expires_at").notNull(), consumedAt: timestamp("consumed_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ ssoStateExpiryIdx: index("sso_state_expiry_idx").on(table.expiresAt) }));

export const userExternalIdentities = pgTable("user_external_identities", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), provider: text("provider").notNull(), issuer: text("issuer").notNull(), subject: text("subject").notNull(), email: text("email").notNull(), createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({ providerSubjectUnique: uniqueIndex("external_identity_provider_subject_unique").on(table.provider, table.issuer, table.subject), userProviderUnique: uniqueIndex("external_identity_user_provider_unique").on(table.userId, table.provider, table.issuer) }));

export const modelRoutingRules = pgTable("model_routing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  keywords: text("keywords").array().notNull(),
  targetModel: text("target_model").notNull(),
  priority: integer("priority").default(0).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  routingOrgIdx: index("routing_org_priority_idx").on(table.organizationId, table.priority),
}));
