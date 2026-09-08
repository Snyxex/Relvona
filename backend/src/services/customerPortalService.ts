import crypto from "crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { conversations, customers, tickets } from "../db/schema.js";
import { anonymousVisitors, customerPortalAccounts, customerPortalMagicLinks, customerPortalSessions, customerPortalVisitorLinks, visitorConversations, visitorMemories } from "../db/extendedCustomerExperienceSchema.js";
import { CustomerPortalDeliveryService } from "./customerPortalDeliveryService.js";

function portalEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.CUSTOMER_PORTAL_ENABLED === "true";
}

function portalSecret(): string {
  const configured = process.env.PORTAL_TOKEN_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("PORTAL_TOKEN_SECRET is required for customer portal tokens");
  return "development-only-customer-portal-secret-do-not-use-in-production";
}

function tokenHash(token: string): string {
  return crypto.createHmac("sha256", portalSecret()).update(token).digest("hex");
}

function createScopedToken(organizationId: string): string {
  return `${organizationId}.${crypto.randomBytes(32).toString("base64url")}`;
}

function parseScopedToken(token: unknown): { organizationId: string; token: string } | undefined {
  if (typeof token !== "string" || token.length > 300) return undefined;
  const [organizationId, raw, extra] = token.split(".");
  if (extra || !organizationId || !raw || !/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[A-Za-z0-9_-]{32,}$/.test(raw)) return undefined;
  return { organizationId, token };
}

function normalizeEmail(email: unknown): string | undefined {
  if (typeof email !== "string") return undefined;
  const value = email.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return undefined;
  return value;
}

function visitorKeyHash(organizationId: string, rawVisitorToken: unknown): string | undefined {
  if (typeof rawVisitorToken !== "string") return undefined;
  const value = rawVisitorToken.trim();
  if (value.length < 24 || value.length > 200 || !/^[A-Za-z0-9._~-]+$/.test(value)) return undefined;
  const secret = process.env.VISITOR_IDENTITY_SECRET || (process.env.NODE_ENV === "production" ? undefined : "development-only-visitor-identity-secret-do-not-use-in-production");
  if (!secret) throw new Error("VISITOR_IDENTITY_SECRET is required for pseudonymous visitor identity");
  return crypto.createHmac("sha256", secret).update(`${organizationId}:${value}`).digest("hex");
}

export type CustomerPortalSessionContext = {
  organizationId: string;
  accountId: string;
  customerId: string;
  email: string;
};

export class CustomerPortalService {
  static isEnabled() { return portalEnabled(); }

  static async requestMagicLink(data: { organizationId: string; email: unknown }) {
    if (!portalEnabled()) return;
    const email = normalizeEmail(data.email);
    if (!email || !/^[0-9a-f-]{36}$/i.test(data.organizationId)) return;

    const result = await withTenantTransaction(data.organizationId, async (tx) => {
      let [customer] = await tx.select().from(customers)
        .where(and(eq(customers.organizationId, data.organizationId), eq(customers.email, email))).limit(1);
      if (!customer) [customer] = await tx.insert(customers).values({ organizationId: data.organizationId, email, name: null }).returning();

      let [account] = await tx.select().from(customerPortalAccounts)
        .where(and(eq(customerPortalAccounts.organizationId, data.organizationId), eq(customerPortalAccounts.customerId, customer.id))).limit(1);
      if (!account) [account] = await tx.insert(customerPortalAccounts).values({ organizationId: data.organizationId, customerId: customer.id }).returning();
      if (account.status === "disabled") return undefined;

      const token = createScopedToken(data.organizationId);
      const purpose = account.emailVerifiedAt ? "login" as const : "verify" as const;
      await tx.insert(customerPortalMagicLinks).values({ organizationId: data.organizationId, accountId: account.id, tokenHash: tokenHash(token), purpose, expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
      return { token, purpose };
    });

    if (!result) return;
    const publicUrl = (process.env.PORTAL_PUBLIC_URL || "http://localhost:3000/customer-portal").replace(/\/$/, "");
    await CustomerPortalDeliveryService.sendMagicLink({ organizationId: data.organizationId, email, purpose: result.purpose, magicLink: `${publicUrl}/verify?token=${encodeURIComponent(result.token)}` });
  }

  static async consumeMagicLink(rawToken: unknown) {
    if (!portalEnabled()) throw new Error("Customer portal disabled");
    const parsed = parseScopedToken(rawToken);
    if (!parsed) throw new Error("Invalid or expired magic link");
    return withTenantTransaction(parsed.organizationId, async (tx) => {
      const now = new Date();
      const [magicLink] = await tx.update(customerPortalMagicLinks).set({ usedAt: now }).where(and(
        eq(customerPortalMagicLinks.organizationId, parsed.organizationId),
        eq(customerPortalMagicLinks.tokenHash, tokenHash(parsed.token)),
        isNull(customerPortalMagicLinks.usedAt),
        gt(customerPortalMagicLinks.expiresAt, now),
      )).returning();
      if (!magicLink) throw new Error("Invalid or expired magic link");

      const [account] = await tx.select().from(customerPortalAccounts)
        .where(and(eq(customerPortalAccounts.organizationId, parsed.organizationId), eq(customerPortalAccounts.id, magicLink.accountId))).limit(1);
      if (!account || account.status === "disabled") throw new Error("Portal account unavailable");

      await tx.update(customerPortalAccounts).set({ status: "active", emailVerifiedAt: account.emailVerifiedAt || now, lastLoginAt: now, updatedAt: now }).where(and(eq(customerPortalAccounts.organizationId, parsed.organizationId), eq(customerPortalAccounts.id, account.id)));

      const sessionToken = createScopedToken(parsed.organizationId);
      await tx.insert(customerPortalSessions).values({ organizationId: parsed.organizationId, accountId: account.id, tokenHash: tokenHash(sessionToken), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
      return { sessionToken, expiresInSeconds: 30 * 24 * 60 * 60 };
    });
  }

  static async authenticate(rawToken: unknown): Promise<CustomerPortalSessionContext> {
    if (!portalEnabled()) throw new Error("Customer portal disabled");
    const parsed = parseScopedToken(rawToken);
    if (!parsed) throw new Error("Portal authentication required");
    return withTenantTransaction(parsed.organizationId, async (tx) => {
      const [row] = await tx.select({ sessionId: customerPortalSessions.id, accountId: customerPortalAccounts.id, customerId: customers.id, email: customers.email })
        .from(customerPortalSessions)
        .innerJoin(customerPortalAccounts, eq(customerPortalSessions.accountId, customerPortalAccounts.id))
        .innerJoin(customers, eq(customerPortalAccounts.customerId, customers.id))
        .where(and(
          eq(customerPortalSessions.organizationId, parsed.organizationId),
          eq(customerPortalSessions.tokenHash, tokenHash(parsed.token)),
          isNull(customerPortalSessions.revokedAt),
          gt(customerPortalSessions.expiresAt, new Date()),
          eq(customerPortalAccounts.status, "active"),
        )).limit(1);
      if (!row || !row.email) throw new Error("Portal authentication required");
      await tx.update(customerPortalSessions).set({ lastSeenAt: new Date() }).where(and(eq(customerPortalSessions.organizationId, parsed.organizationId), eq(customerPortalSessions.id, row.sessionId)));
      return { organizationId: parsed.organizationId, accountId: row.accountId, customerId: row.customerId, email: row.email };
    });
  }

  static async revokeSession(rawToken: unknown) {
    const parsed = parseScopedToken(rawToken);
    if (!parsed) return;
    await withTenantTransaction(parsed.organizationId, async (tx) => {
      await tx.update(customerPortalSessions).set({ revokedAt: new Date() }).where(and(eq(customerPortalSessions.organizationId, parsed.organizationId), eq(customerPortalSessions.tokenHash, tokenHash(parsed.token))));
    });
  }

  static async linkVisitor(data: { session: CustomerPortalSessionContext; visitorToken: unknown; consentVersion: string }) {
    const hash = visitorKeyHash(data.session.organizationId, data.visitorToken);
    if (!hash || !data.consentVersion || data.consentVersion.length > 64) throw new Error("Invalid visitor link request");
    return withTenantTransaction(data.session.organizationId, async (tx) => {
      const [visitor] = await tx.select().from(anonymousVisitors).where(and(eq(anonymousVisitors.organizationId, data.session.organizationId), eq(anonymousVisitors.visitorKeyHash, hash))).limit(1);
      if (!visitor) throw new Error("Visitor not found");
      const [link] = await tx.insert(customerPortalVisitorLinks).values({ organizationId: data.session.organizationId, accountId: data.session.accountId, visitorId: visitor.id, consentVersion: data.consentVersion })
        .onConflictDoUpdate({ target: [customerPortalVisitorLinks.organizationId, customerPortalVisitorLinks.accountId, customerPortalVisitorLinks.visitorId], set: { consentVersion: data.consentVersion, consentedAt: new Date(), revokedAt: null } }).returning();
      return link;
    });
  }

  static async revokeVisitorLink(data: { session: CustomerPortalSessionContext; visitorId: string }) {
    await withTenantTransaction(data.session.organizationId, async (tx) => {
      await tx.update(customerPortalVisitorLinks).set({ revokedAt: new Date() }).where(and(eq(customerPortalVisitorLinks.organizationId, data.session.organizationId), eq(customerPortalVisitorLinks.accountId, data.session.accountId), eq(customerPortalVisitorLinks.visitorId, data.visitorId)));
    });
  }

  static async dashboard(session: CustomerPortalSessionContext) {
    return withTenantTransaction(session.organizationId, async (tx) => {
      const [conversationRows, ticketRows, linkedVisitors] = await Promise.all([
        tx.select().from(conversations).where(and(eq(conversations.organizationId, session.organizationId), eq(conversations.customerId, session.customerId))),
        tx.select().from(tickets).where(and(eq(tickets.organizationId, session.organizationId), eq(tickets.customerId, session.customerId))),
        tx.select({ visitorId: customerPortalVisitorLinks.visitorId }).from(customerPortalVisitorLinks).where(and(eq(customerPortalVisitorLinks.organizationId, session.organizationId), eq(customerPortalVisitorLinks.accountId, session.accountId), isNull(customerPortalVisitorLinks.revokedAt))),
      ]);
      const visitorIds = linkedVisitors.map((item) => item.visitorId);
      const linkedConversationRows = visitorIds.length
        ? await tx.select({ conversation: conversations }).from(visitorConversations).innerJoin(conversations, eq(visitorConversations.conversationId, conversations.id)).where(and(eq(visitorConversations.organizationId, session.organizationId), inArray(visitorConversations.visitorId, visitorIds)))
        : [];
      const memoryRows = visitorIds.length
        ? await tx.select().from(visitorMemories).where(and(eq(visitorMemories.organizationId, session.organizationId), inArray(visitorMemories.visitorId, visitorIds)))
        : [];
      const byId = new Map<string, typeof conversations.$inferSelect>();
      [...conversationRows, ...linkedConversationRows.map((row) => row.conversation)].forEach((conversation) => byId.set(conversation.id, conversation));
      const now = new Date();
      return {
        customer: { id: session.customerId, email: session.email },
        conversations: [...byId.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
        tickets: ticketRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
        memories: memoryRows.filter((memory) => memory.status === "active" && (!memory.expiresAt || memory.expiresAt > now)),
        linkedVisitors: visitorIds,
      };
    });
  }
}
