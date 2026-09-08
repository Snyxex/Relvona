import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, customers, organizations, tickets, users } from "./schema.js";

/**
 * Pseudonymous website visitor identity.
 *
 * The browser token itself is never persisted. visitorKeyHash is an HMAC of
 * the opaque client token, scoped by organization. No name, email, IP address,
 * user-agent fingerprint, or other direct identifier belongs in this table.
 */
export const anonymousVisitors = pgTable("anonymous_visitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  visitorKeyHash: text("visitor_key_hash").notNull(),
  memoryEnabled: boolean("memory_enabled").default(true).notNull(),
  privacyConsentVersion: text("privacy_consent_version"),
  privacyConsentAt: timestamp("privacy_consent_at"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  visitorKeyUnique: uniqueIndex("anonymous_visitor_key_unique").on(table.organizationId, table.visitorKeyHash),
  visitorOrgIdx: index("anonymous_visitor_org_idx").on(table.organizationId, table.lastSeenAt),
}));

export const visitorConversations = pgTable("visitor_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  visitorId: uuid("visitor_id").references(() => anonymousVisitors.id, { onDelete: "cascade" }).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  conversationUnique: uniqueIndex("visitor_conversation_unique").on(table.organizationId, table.conversationId),
  visitorHistoryIdx: index("visitor_conversation_history_idx").on(table.organizationId, table.visitorId, table.createdAt),
}));

export const visitorMemories = pgTable("visitor_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  visitorId: uuid("visitor_id").references(() => anonymousVisitors.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  summary: text("summary").notNull(),
  status: text("status").default("active").notNull(),
  sourceConversationId: uuid("source_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").default({}).notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  visitorMemoryIdx: index("visitor_memory_idx").on(table.organizationId, table.visitorId, table.status, table.updatedAt),
}));

export const customerPortalAccounts = pgTable("customer_portal_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("pending_verification").notNull(),
  emailVerifiedAt: timestamp("email_verified_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgCustomerPortalUnique: uniqueIndex("customer_portal_org_customer_unique").on(table.organizationId, table.customerId),
  portalAccountOrgIdx: index("customer_portal_account_org_idx").on(table.organizationId, table.status),
}));

export const customerPortalMagicLinks = pgTable("customer_portal_magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  accountId: uuid("account_id").references(() => customerPortalAccounts.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose").default("login").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  portalMagicLinkIdx: index("customer_portal_magic_link_idx").on(table.organizationId, table.accountId, table.expiresAt),
}));

export const customerPortalSessions = pgTable("customer_portal_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  accountId: uuid("account_id").references(() => customerPortalAccounts.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
}, (table) => ({
  portalSessionIdx: index("customer_portal_session_idx").on(table.organizationId, table.accountId, table.expiresAt),
}));

export const customerPortalVisitorLinks = pgTable("customer_portal_visitor_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  accountId: uuid("account_id").references(() => customerPortalAccounts.id, { onDelete: "cascade" }).notNull(),
  visitorId: uuid("visitor_id").references(() => anonymousVisitors.id, { onDelete: "cascade" }).notNull(),
  consentVersion: text("consent_version").notNull(),
  consentedAt: timestamp("consented_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  portalVisitorUnique: uniqueIndex("customer_portal_visitor_unique").on(table.organizationId, table.accountId, table.visitorId),
  portalVisitorIdx: index("customer_portal_visitor_idx").on(table.organizationId, table.visitorId),
}));

/** Per-tenant SLA targets. One row per priority keeps V1 configuration simple. */
export const ticketSlaPolicies = pgTable("ticket_sla_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  priority: text("priority").notNull(),
  firstResponseMinutes: integer("first_response_minutes").notNull(),
  resolutionMinutes: integer("resolution_minutes").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgPrioritySlaUnique: uniqueIndex("ticket_sla_org_priority_unique").on(table.organizationId, table.priority),
}));

/** Operational case data separated from the existing ticket row for compatibility. */
export const ticketCaseMetadata = pgTable("ticket_case_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(),
  firstResponseDueAt: timestamp("first_response_due_at"),
  resolutionDueAt: timestamp("resolution_due_at"),
  firstRespondedAt: timestamp("first_responded_at"),
  resolvedAt: timestamp("resolved_at"),
  waitingSince: timestamp("waiting_since"),
  slaPausedAt: timestamp("sla_paused_at"),
  totalPausedSeconds: integer("total_paused_seconds").default(0).notNull(),
  escalationLevel: integer("escalation_level").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ticketCaseUnique: uniqueIndex("ticket_case_ticket_unique").on(table.organizationId, table.ticketId),
  ticketCaseSlaIdx: index("ticket_case_sla_idx").on(table.organizationId, table.resolutionDueAt),
}));

/** Append-only audit timeline for status, priority, assignment and SLA changes. */
export const ticketCaseEvents = pgTable("ticket_case_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ticketCaseEventIdx: index("ticket_case_event_idx").on(table.organizationId, table.ticketId, table.createdAt),
}));
