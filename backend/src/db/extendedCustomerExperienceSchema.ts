import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, customers, organizations } from "./schema.js";

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

/**
 * Optional customer portal identity. Portal accounts are deliberately separate
 * from staff users / Better Auth. The support customer record remains the owner
 * of contact data; this table only represents portal access and verification.
 */
export const customerPortalAccounts = pgTable("customer_portal_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  customerId: uuid("customer_id")
    .references(() => customers.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").default("pending_verification").notNull(), // pending_verification | active | disabled
  emailVerifiedAt: timestamp("email_verified_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgCustomerPortalUnique: uniqueIndex("customer_portal_org_customer_unique").on(table.organizationId, table.customerId),
  portalAccountOrgIdx: index("customer_portal_account_org_idx").on(table.organizationId, table.status),
}));

/** One-time verification/login capability; only its HMAC hash is persisted. */
export const customerPortalMagicLinks = pgTable("customer_portal_magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  accountId: uuid("account_id")
    .references(() => customerPortalAccounts.id, { onDelete: "cascade" })
    .notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose").default("login").notNull(), // verify | login
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  portalMagicLinkIdx: index("customer_portal_magic_link_idx").on(table.organizationId, table.accountId, table.expiresAt),
}));

/** Opaque bearer sessions for customers; independent from staff auth cookies. */
export const customerPortalSessions = pgTable("customer_portal_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  accountId: uuid("account_id")
    .references(() => customerPortalAccounts.id, { onDelete: "cascade" })
    .notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
}, (table) => ({
  portalSessionIdx: index("customer_portal_session_idx").on(table.organizationId, table.accountId, table.expiresAt),
}));

/**
 * Explicit consent record connecting a pseudonymous visitor history to an
 * authenticated customer portal account.
 */
export const customerPortalVisitorLinks = pgTable("customer_portal_visitor_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  accountId: uuid("account_id")
    .references(() => customerPortalAccounts.id, { onDelete: "cascade" })
    .notNull(),
  visitorId: uuid("visitor_id")
    .references(() => anonymousVisitors.id, { onDelete: "cascade" })
    .notNull(),
  consentVersion: text("consent_version").notNull(),
  consentedAt: timestamp("consented_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  portalVisitorUnique: uniqueIndex("customer_portal_visitor_unique").on(table.organizationId, table.accountId, table.visitorId),
  portalVisitorIdx: index("customer_portal_visitor_idx").on(table.organizationId, table.visitorId),
}));
