import { Request, Response, NextFunction } from "express";
import { db } from "../db/index.js";
import { users, organizationMembers, organizations, apiKeys, platformSupportSessions } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { setLogContext } from "../observability/logger.js";
import crypto from "crypto";
import { getCurrentUser } from "../auth/session.js";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    preferredLanguage: string;
    systemRole: string;
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
}

// Better Auth is the sole browser-session authority.  Do not accept bearer
// credentials here: dashboard requests must carry the HttpOnly session cookie.
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Authentication required" });
  }
}

export function requirePlatformAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (req.user.systemRole !== "superadmin") return res.status(403).json({ error: "Nur Plattformadministratoren dürfen diese Einstellungen verwalten." });
  next();
}

// Middleware: Require Tenant Context & Resolve Role
export async function tenantContext(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required before context selection" });
    }

    const orgId = req.headers["x-organization-id"] as string;
    const orgSlug = req.headers["x-organization-slug"] as string;

    if (!orgId && !orgSlug) {
      // Find first organization user belongs to
      const [firstMembership] = await db
        .select({
          org: organizations,
          member: organizationMembers,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(eq(organizationMembers.userId, req.user.id))
        .limit(1);

      if (!firstMembership || firstMembership.org.status !== "active" || firstMembership.member.status !== "active") {
        return res.status(403).json({ error: "User does not belong to any organization" });
      }

      req.organization = {
        id: firstMembership.org.id,
        name: firstMembership.org.name,
        slug: firstMembership.org.slug,
        role: firstMembership.member.role,
      };
      setLogContext({ organizationId: req.organization.id });

      return next();
    }

    if (req.user.systemRole === "superadmin" && orgId) {
      if (!/^[0-9a-f-]{36}$/i.test(orgId)) return res.status(400).json({ error: "Invalid organization ID" });
      const supportSessionId = req.headers["x-support-session-id"] as string;
      if (!supportSessionId || !/^[0-9a-f-]{36}$/i.test(supportSessionId)) return res.status(403).json({ error: "SUPPORT_ACCESS_REQUIRED" });
      const [supportSession] = await db.select().from(platformSupportSessions).where(and(
        eq(platformSupportSessions.id, supportSessionId),
        eq(platformSupportSessions.platformAdminUserId, req.user.id),
        eq(platformSupportSessions.organizationId, orgId),
      )).limit(1);
      if (!supportSession || supportSession.endedAt || supportSession.expiresAt <= new Date()) return res.status(403).json({ error: "SUPPORT_ACCESS_EXPIRED" });
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
      if (!org) return res.status(404).json({ error: "Organization not found" });
      req.organization = { id: org.id, name: org.name, slug: org.slug, role: "admin" };
      setLogContext({ organizationId: org.id });
      return next();
    }
    // Resolve requested org
    let targetOrgId = orgId;
    if (!targetOrgId && orgSlug) {
      const [foundOrg] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
      if (foundOrg) targetOrgId = foundOrg.id;
    }

    if (!targetOrgId) {
      return res.status(404).json({ error: "Specified organization not found" });
    }

    const [membership] = await db
      .select({
        org: organizations,
        member: organizationMembers,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(
        and(
          eq(organizationMembers.organizationId, targetOrgId),
          eq(organizationMembers.userId, req.user.id)
        )
      )
      .limit(1);

    if (!membership || membership.org.status !== "active" || membership.member.status !== "active") {
      return res.status(403).json({ error: "Access denied: User is not a member of this organization" });
    }

    req.organization = {
      id: membership.org.id,
      name: membership.org.name,
      slug: membership.org.slug,
      role: membership.member.role,
    };
    setLogContext({ organizationId: req.organization.id });

    next();
  } catch (error) {
    return res.status(500).json({ error: "Failed to resolve tenant context" });
  }
}

// Middleware: Role-Based Access Control (RBAC)
export function requireRole(allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.organization) {
      return res.status(403).json({ error: "Organization context missing" });
    }

    if (!allowedRoles.includes(req.organization.role)) {
      return res.status(403).json({ error: `Insufficient permissions. Required role: ${allowedRoles.join(" or ")}` });
    }

    next();
  };
}

// Middleware: API Key Authentication (for external integrations)
export async function authenticateApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  const apiKeyHeader = req.headers["x-api-key"] as string;
  if (!apiKeyHeader || !/^(?:acs|sk)_live_[A-Za-z0-9_-]{32,}$/.test(apiKeyHeader)) {
    return res.status(401).json({ error: "Missing API Key" });
  }

  const keyPrefix = apiKeyHeader.slice(0, 17);
  const keyHash = crypto.createHash("sha256").update(apiKeyHeader).digest("hex");
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyPrefix, keyPrefix), eq(apiKeys.keyHash, keyHash))).limit(1);
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) {
    return res.status(401).json({ error: "Invalid API Key" });
  }
  const [org] = await db.select().from(organizations).where(eq(organizations.id, key.organizationId)).limit(1);
  if (!org) return res.status(401).json({ error: "Invalid API Key" });
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));

  req.organization = {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: "admin",
  };
  setLogContext({ organizationId: org.id });

  next();
}
