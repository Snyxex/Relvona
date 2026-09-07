import crypto from "crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { anonymousVisitors, visitorConversations, visitorMemories } from "../db/extendedCustomerExperienceSchema.js";

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
    await db.insert(visitorConversations).values(data).onConflictDoNothing({
      target: [visitorConversations.organizationId, visitorConversations.conversationId],
    });
  }

  static async memoriesForConversation(organizationId: string, conversationId: string, limit = 8) {
    const [link] = await db.select({ visitorId: visitorConversations.visitorId })
      .from(visitorConversations)
      .where(and(eq(visitorConversations.organizationId, organizationId), eq(visitorConversations.conversationId, conversationId)))
      .limit(1);
    if (!link) return [];
    const visitor = await db.select({ memoryEnabled: anonymousVisitors.memoryEnabled })
      .from(anonymousVisitors)
      .where(and(eq(anonymousVisitors.organizationId, organizationId), eq(anonymousVisitors.id, link.visitorId)))
      .limit(1);
    if (!visitor[0]?.memoryEnabled) return [];
    return db.select().from(visitorMemories)
      .where(and(
        eq(visitorMemories.organizationId, organizationId),
        eq(visitorMemories.visitorId, link.visitorId),
        eq(visitorMemories.status, "active"),
        or(isNull(visitorMemories.expiresAt), gt(visitorMemories.expiresAt, new Date())),
      ))
      .orderBy(desc(visitorMemories.updatedAt))
      .limit(Math.max(1, Math.min(limit, 20)));
  }

  static async setMemoryEnabled(data: { organizationId: string; visitorId: string; enabled: boolean }) {
    const [visitor] = await db.update(anonymousVisitors)
      .set({ memoryEnabled: data.enabled, updatedAt: new Date() })
      .where(and(eq(anonymousVisitors.organizationId, data.organizationId), eq(anonymousVisitors.id, data.visitorId)))
      .returning();
    if (!visitor) throw new Error("Visitor not found");
    if (!data.enabled) {
      await db.delete(visitorMemories).where(and(eq(visitorMemories.organizationId, data.organizationId), eq(visitorMemories.visitorId, data.visitorId)));
    }
    return visitor;
  }
}
