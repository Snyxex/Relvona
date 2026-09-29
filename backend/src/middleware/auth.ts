import { Request, Response, NextFunction } from "express";
import { db, pool } from "../db/index.js";
import { setDatabaseTenant } from "../db/tenantContext.js";
import { organizationMembers, organizations, apiKeys, platformSupportSessions } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { setLogContext } from "../observability/logger.js";
import crypto from "crypto";
import { getCurrentUser, getOrganizationMembership, hasOrganizationRole, type OrganizationRole } from "../auth/session.js";
import { dashboardDomainFromRequest, organizationForVerifiedDashboardDomain } from "../services/dashboardDomainService.js";
import { permissionsForRole, type OrganizationPermission } from "../services/organizationRbacService.js";
import type { TwoFactorPolicy } from "../services/platformSecurityService.js";

export interface AuthRequest extends Request {
  dashboardOrganizationId?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    preferredLanguage: string;
    themePreferences: Record<string, unknown>;
    twoFactorEnabled: boolean;
    twoFactorPolicy: TwoFactorPolicy;
    isPlatformAdmin: boolean;
    /** Temporary API compatibility only. Authorization must use isPlatformAdmin. */
    systemRole: "superadmin" | "user";
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
    role: OrganizationRole;
    permissions: OrganizationPermission[];
  };
}

export async function bindDashboardDomain(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const domain = dashboardDomainFromRequest(req.get("origin") || req.get("host"));
    const organizationId = await organizationForVerifiedDashboardDomain(domain);
    if (organizationId) req.dashboardOrganizationId = organizationId;
    return next();
  } catch { return res.status(503).json({ error: "Dashboard domain verification unavailable" }); }
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    req.user = user;
    const profileEndpoint = req.originalUrl.startsWith("/api/v1/auth/");
    if (user.twoFactorPolicy === "required" && !user.twoFactorEnabled && !profileEndpoint) {
      return res.status(403).json({ error: "TWO_FACTOR_SETUP_REQUIRED", code: "TWO_FACTOR_SETUP_REQUIRED", message: "Zwei-Faktor-Authentifizierung muss zuerst in den Profil-Einstellungen eingerichtet werden." });
    }
    next();
  } catch {
    return res.status(401).json({ error: "Authentication required" });
  }
}

export function requirePlatformAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!req.user.isPlatformAdmin) return res.status(403).json({ error: "Nur Plattformadministratoren dürfen diese Einstellungen verwalten." });
  next();
}

export async function requireOrganizationMember(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || !req.organization) return res.status(403).json({ error: "Organization context missing" });
  const membership = await getOrganizationMembership(req.user.id, req.organization.id);
  if (!membership) return res.status(403).json({ error: "Organization membership required" });
  setDatabaseTenant(membership.id);
  req.organization = { ...membership, permissions: await permissionsForRole(membership.id, membership.role) };
  return next();
}

export async function tenantContext(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required before context selection" });

    const requestedOrgId = req.headers["x-organization-id"] as string;
    const orgId = req.dashboardOrganizationId || requestedOrgId;
    const orgSlug = req.headers["x-organization-slug"] as string;

    if (req.dashboardOrganizationId && ((requestedOrgId && requestedOrgId !== req.dashboardOrganizationId) || orgSlug)) {
      return res.status(403).json({ error: "DASHBOARD_DOMAIN_TENANT_MISMATCH" });
    }

    if (!orgId && !orgSlug) {
      const [firstMembership] = await db
        .select({ org: organizations, member: organizationMembers })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(eq(organizationMembers.userId, req.user.id))
        .limit(1);

      if (!firstMembership || firstMembership.org.status !== "active" || firstMembership.member.status !== "active") {
        return res.status(403).json({ error: "User does not belong to any organization" });
      }

      const organization = {
        id: firstMembership.org.id,
        name: firstMembership.org.name,
        slug: firstMembership.org.slug,
        role: firstMembership.member.role as OrganizationRole,
        permissions: [] as OrganizationPermission[],
      };
      setDatabaseTenant(organization.id);
      organization.permissions = await permissionsForRole(organization.id, organization.role);
      req.organization = organization;
      setLogContext({ organizationId: organization.id });
      return next();
    }

    if (orgId && !/^[0-9a-f-]{36}$/i.test(orgId)) return res.status(400).json({ error: "Invalid organization ID" });

    let targetOrgId = orgId;
    if (!targetOrgId && orgSlug) {
      const [foundOrg] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
      if (foundOrg) targetOrgId = foundOrg.id;
    }

    if (!targetOrgId) return res.status(404).json({ error: "Specified organization not found" });

    // A real organization membership always takes precedence over temporary
    // platform support access. The bootstrap account is both platform admin
    // and owner of its initial organization and must retain its owner role.
    const membership = await getOrganizationMembership(req.user.id, targetOrgId);
    if (membership) {
      setDatabaseTenant(membership.id);
      req.organization = { ...membership, permissions: await permissionsForRole(membership.id, membership.role) };
      setLogContext({ organizationId: membership.id });
      return next();
    }

    if (req.user.isPlatformAdmin) {
      const supportSessionId = req.headers["x-support-session-id"] as string;
      if (!supportSessionId || !/^[0-9a-f-]{36}$/i.test(supportSessionId)) return res.status(403).json({ error: "SUPPORT_ACCESS_REQUIRED" });
      const [supportSession] = await db.select().from(platformSupportSessions).where(and(
        eq(platformSupportSessions.id, supportSessionId),
        eq(platformSupportSessions.platformAdminUserId, req.user.id),
        eq(platformSupportSessions.organizationId, targetOrgId),
      )).limit(1);
      if (!supportSession || supportSession.endedAt || supportSession.expiresAt <= new Date()) return res.status(403).json({ error: "SUPPORT_ACCESS_EXPIRED" });
      const [org] = await db.select().from(organizations).where(eq(organizations.id, targetOrgId)).limit(1);
      if (!org) return res.status(404).json({ error: "Organization not found" });
      setDatabaseTenant(org.id);
      req.organization = { id: org.id, name: org.name, slug: org.slug, role: "admin", permissions: await permissionsForRole(org.id, "admin") };
      setLogContext({ organizationId: org.id });
      return next();
    }
    return res.status(403).json({ error: "Access denied: User is not a member of this organization" });
  } catch {
    return res.status(500).json({ error: "Failed to resolve tenant context" });
  }
}

export function requireRole(allowedRoles: string[]) {
  const roles = allowedRoles as OrganizationRole[];
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.organization) return res.status(403).json({ error: "Organization context missing" });
    const permission = permissionForRequest(req);
    if (permission) {
      if (!req.organization.permissions.includes(permission)) return res.status(403).json({ error: "PERMISSION_REQUIRED", permission });
      return next();
    }
    if (!hasOrganizationRole(req.organization, roles)) {
      return res.status(403).json({ error: `Insufficient permissions. Required role: ${allowedRoles.join(" or ")}` });
    }
    next();
  };
}

export function requirePermission(permission: OrganizationPermission) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.organization) return res.status(403).json({ error: "Organization context missing" });
    if (!req.organization.permissions.includes(permission)) return res.status(403).json({ error: "PERMISSION_REQUIRED", permission });
    return next();
  };
}

function permissionForRequest(req: AuthRequest): OrganizationPermission | undefined {
  const path = (req.originalUrl || `${req.baseUrl}${req.path}`).split("?")[0];
  const read = req.method === "GET" || req.method === "HEAD";
  if (path.includes("/organizations/current/role-policies")) return "roles.manage";
  if (path.includes("/organizations/members")) return read ? "members.view" : "members.manage";
  if (path.includes("/organizations/invitations")) return "members.manage";
  if (path.includes("/organizations/")) return read ? "organization.view" : "organization.manage";
  if (path.includes("/admin/employees")) return read ? "members.view" : "members.manage";
  if (path.includes("/admin/")) return read ? "settings.view" : "settings.manage";
  if (path.includes("/conversations") || path.includes("/attachments")) return read ? "conversations.view" : "conversations.manage";
  if (path.includes("/tickets")) return read ? "tickets.view" : "tickets.manage";
  if (path.includes("/customers")) return read ? "customers.view" : "customers.manage";
  if (path.includes("/knowledge") || path.includes("/knowledge-intelligence")) return read ? "knowledge.view" : "knowledge.manage";
  if (path.includes("/assistants")) return read ? "assistants.view" : "assistants.manage";
  if (path.includes("/analytics")) return read ? "analytics.view" : "analytics.manage";
  if (path.includes("/scheduling")) return read ? "scheduling.view" : "scheduling.manage";
  if (path.includes("/tools")) return read ? "tools.view" : "tools.manage";
  if (path.includes("/integrations") || path.includes("/calendar-oauth")) return read ? "integrations.view" : "integrations.manage";
  if (path.includes("/notifications")) return read ? "notifications.view" : "notifications.manage";
  if (path.includes("/storage")) return "storage.manage";
  if (path.includes("/visitor-memory")) return read ? "visitor_memory.view" : "visitor_memory.manage";
  if (path.includes("/webhooks")) return "webhooks.manage";
  return undefined;
}

export const requireOrganizationRole = requireRole;
export const requireOrganizationPermission = requireRole;

export async function authenticateApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  const apiKeyHeader = req.headers["x-api-key"] as string;
  if (!apiKeyHeader || !/^(?:acs|sk)_live_[A-Za-z0-9_-]{32,}$/.test(apiKeyHeader)) return res.status(401).json({ error: "Missing API Key" });

  const keyPrefix = apiKeyHeader.slice(0, 17);
  const keyHash = crypto.createHash("sha256").update(apiKeyHeader).digest("hex");
  const resolved = await pool.query<{ id: string; organization_id: string; revoked_at: Date | null; expires_at: Date | null }>(
    "SELECT * FROM public.supportai_resolve_api_key($1, $2)",
    [keyPrefix, keyHash],
  );
  const key = resolved.rows[0];
  if (!key || key.revoked_at || (key.expires_at && key.expires_at <= new Date())) return res.status(401).json({ error: "Invalid API Key" });

  setDatabaseTenant(key.organization_id);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, key.organization_id)).limit(1);
  if (!org || org.status !== "active") return res.status(401).json({ error: "Invalid API Key" });
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));

  req.organization = { id: org.id, name: org.name, slug: org.slug, role: "admin", permissions: await permissionsForRole(org.id, "admin") };
  setLogContext({ organizationId: org.id });
  next();
}
