import crypto from "crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import { conversations } from "../db/schema.js";
import { anonymousVisitors, visitorConversations, visitorMemories } from "../db/extendedCustomerExperienceSchema.js";

const allowedMemoryTypes = new Set(["support_issue", "preference", "environment", "resolution", "temporary"]);

function identitySecret(): string {
  const configured = process.env.VISITOR_IDENTITY_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("VISITOR_IDENTITY_SECRET is required for pseudonymous visitor identity");
  return "development-only-visitor-identity-secret-do-not-use-in-production";
}

function normalizeVisitorToken(token: unknown): string | undefined {
  if (typeof token !== "string") return undefined;
  const value = token.trim();
  if (value.length < 24 || value.length > 200 || !/^[A-Za-z0-9._~-]+$/.test(value)) return undefined;
  return value;
}

function visitorKeyHash(organizationId: string, visitorToken: string): string {
  return crypto.createHmac("sha256", identitySecret()).update(`${organizationId}:${visitorToken}`).digest("hex");
}

export class VisitorIdentityService {
  static async resolveVisitor(organizationId: string, rawVisitorToken: unknown) {
    const visitorToken = normalizeVisitorToken(rawVisitorToken);
    if (!visitorToken) return undefined;
    const hash = visitorKeyHash(organizationId, visitorToken);
    const [existing] = await db.select().from(anonymousVisitors)
      .where(and(eq(anonymousVisitors.organizationId, organizationId), eq(anonymousVisitors.visitorKeyHash, hash)))
      .limit(1);
    if (existing) {
      const [updated] = await db.update(anonymousVisitors)
        .set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(and(eq(anonymousVisitors.id, existing.id), eq(anonymousVisitors.organizationId, organizationId)))
        .returning();
      return updated;
    }
    const [created] = await db.insert(anonymousVisitors).values({ organizationId, visitorKeyHash: hash }).returning();
    return created;
  }

  static async linkConversation(data: { organizationId: string; visitorId: string; conversationId: string }) {
    const [conversation] = await db.select({ id: conversations.id }).from(conversations)
      .where(and(eq(conversations.organizationId, data.organizationId), eq(conversations.id, data.conversationId)))
      .limit(1);
    if (!conversation) throw new Error("Conversation not found");
    await db.insert(visitorConversations).values(data).onConflictDoNothing({ target: [visitorConversations.organizationId, visitorConversations.conversationId] });
  }

  static async memoriesForConversation(organizationId: string, conversationId: string, limit = 8) {
    const [link] = await db.select({ visitorId: visitorConversations.visitorId }).from(visitorConversations)
      .where(and(eq(visitorConversations.organizationId, organizationId), eq(visitorConversations.conversationId, conversationId))).limit(1);
    if (!link) return [];
    return this.memoriesForVisitor(organizationId, link.visitorId, limit);
  }

  static async memoriesForVisitor(organizationId: string, visitorId: string, limit = 20) {
    const [visitor] = await db.select({ memoryEnabled: anonymousVisitors.memoryEnabled }).from(anonymousVisitors)
      .where(and(eq(anonymousVisitors.organizationId, organizationId), eq(anonymousVisitors.id, visitorId))).limit(1);
    if (!visitor?.memoryEnabled) return [];
    return db.select().from(visitorMemories).where(and(
      eq(visitorMemories.organizationId, organizationId),
      eq(visitorMemories.visitorId, visitorId),
      or(isNull(visitorMemories.expiresAt), gt(visitorMemories.expiresAt, new Date())),
    )).orderBy(desc(visitorMemories.updatedAt)).limit(Math.max(1, Math.min(limit, 100)));
  }

  static async conversationHistory(organizationId: string, visitorId: string, limit = 20) {
    return db.select({ conversationId: visitorConversations.conversationId, state: conversations.state, summary: conversations.summary, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt })
      .from(visitorConversations)
      .innerJoin(conversations, and(eq(conversations.id, visitorConversations.conversationId), eq(conversations.organizationId, organizationId)))
      .where(and(eq(visitorConversations.organizationId, organizationId), eq(visitorConversations.visitorId, visitorId)))
      .orderBy(desc(conversations.updatedAt)).limit(Math.max(1, Math.min(limit, 100)));
  }

  static async createMemory(data: { organizationId: string; visitorId: string; type: string; summary: string; sourceConversationId?: string; expiresAt?: Date; metadata?: Record<string, unknown> }) {
    const type = data.type.trim().toLowerCase();
    const summary = data.summary.trim().replace(/\s+/g, " ").slice(0, 2_000);
    if (!allowedMemoryTypes.has(type)) throw new Error("Unsupported visitor memory type");
    if (summary.length < 3) throw new Error("Visitor memory summary is too short");
    const [visitor] = await db.select({ memoryEnabled: anonymousVisitors.memoryEnabled }).from(anonymousVisitors)
      .where(and(eq(anonymousVisitors.organizationId, data.organizationId), eq(anonymousVisitors.id, data.visitorId))).limit(1);
    if (!visitor) throw new Error("Visitor not found");
    if (!visitor.memoryEnabled) throw new Error("Visitor memory is disabled");
    const [memory] = await db.insert(visitorMemories).values({ organizationId: data.organizationId, visitorId: data.visitorId, type, summary, sourceConversationId: data.sourceConversationId, expiresAt: data.expiresAt, metadata: data.metadata || {} }).returning();
    return memory;
  }

  static async resolveMemory(data: { organizationId: string; visitorId: string; memoryId: string }) {
    const [memory] = await db.update(visitorMemories).set({ status: "resolved", updatedAt: new Date() })
      .where(and(eq(visitorMemories.organizationId, data.organizationId), eq(visitorMemories.visitorId, data.visitorId), eq(visitorMemories.id, data.memoryId))).returning();
    if (!memory) throw new Error("Visitor memory not found");
    return memory;
  }

  static async setMemoryEnabled(data: { organizationId: string; visitorId: string; enabled: boolean }) {
    const [visitor] = await db.update(anonymousVisitors).set({ memoryEnabled: data.enabled, updatedAt: new Date() })
      .where(and(eq(anonymousVisitors.organizationId, data.organizationId), eq(anonymousVisitors.id, data.visitorId))).returning();
    if (!visitor) throw new Error("Visitor not found");
    if (!data.enabled) await db.delete(visitorMemories).where(and(eq(visitorMemories.organizationId, data.organizationId), eq(visitorMemories.visitorId, data.visitorId)));
    return visitor;
  }

  static async privacyStateByToken(organizationId: string, rawVisitorToken: unknown) {
    const visitorToken = normalizeVisitorToken(rawVisitorToken);
    if (!visitorToken) return { exists: false, memoryEnabled: false };
    const hash = visitorKeyHash(organizationId, visitorToken);
    return withTenantTransaction(organizationId, async (tx) => {
      const [visitor] = await tx.select({ id: anonymousVisitors.id, memoryEnabled: anonymousVisitors.memoryEnabled }).from(anonymousVisitors)
        .where(and(eq(anonymousVisitors.organizationId, organizationId), eq(anonymousVisitors.visitorKeyHash, hash))).limit(1);
      return visitor ? { exists: true, memoryEnabled: visitor.memoryEnabled } : { exists: false, memoryEnabled: true };
    });
  }

  static async setMemoryEnabledByToken(data: { organizationId: string; visitorToken: unknown; enabled: boolean; consentVersion?: string }) {
    const visitorToken = normalizeVisitorToken(data.visitorToken);
    if (!visitorToken) throw new Error("Invalid visitor token");
    const hash = visitorKeyHash(data.organizationId, visitorToken);
    return withTenantTransaction(data.organizationId, async (tx) => {
      const [visitor] = await tx.select().from(anonymousVisitors)
        .where(and(eq(anonymousVisitors.organizationId, data.organizationId), eq(anonymousVisitors.visitorKeyHash, hash))).limit(1);
      if (!visitor) throw new Error("Visitor not found");
      const [updated] = await tx.update(anonymousVisitors).set({
        memoryEnabled: data.enabled,
        privacyConsentVersion: data.consentVersion?.slice(0, 64) || visitor.privacyConsentVersion,
        privacyConsentAt: data.enabled ? new Date() : visitor.privacyConsentAt,
        updatedAt: new Date(),
      }).where(and(eq(anonymousVisitors.organizationId, data.organizationId), eq(anonymousVisitors.id, visitor.id))).returning();
      if (!data.enabled) await tx.delete(visitorMemories).where(and(eq(visitorMemories.organizationId, data.organizationId), eq(visitorMemories.visitorId, visitor.id)));
      return { memoryEnabled: updated.memoryEnabled };
    });
  }

  static async eraseVisitorByToken(organizationId: string, rawVisitorToken: unknown) {
    const visitorToken = normalizeVisitorToken(rawVisitorToken);
    if (!visitorToken) return false;
    const hash = visitorKeyHash(organizationId, visitorToken);
    return withTenantTransaction(organizationId, async (tx) => {
      const [deleted] = await tx.delete(anonymousVisitors)
        .where(and(eq(anonymousVisitors.organizationId, organizationId), eq(anonymousVisitors.visitorKeyHash, hash))).returning({ id: anonymousVisitors.id });
      return Boolean(deleted);
    });
  }
}
