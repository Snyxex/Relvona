import { Router } from "express";
import { authenticate, tenantContext, requireRole, requirePlatformAdmin, AuthRequest } from "../middleware/auth.js";
import { db, pool } from "../db/index.js";
import { organizations, organizationMembers, users, apiKeys, organizationInvitations, organizationSettings, organizationDashboardDomains } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import crypto from "crypto";
import { encryptSecret } from "../utils/crypto.js";
import { AuditService } from "../services/auditService.js";
import { newDashboardDomainVerificationToken, normalizeDashboardDomain, verifyDashboardDomain } from "../services/dashboardDomainService.js";

const router = Router();
const ipOf = (req: AuthRequest) => req.ip || req.socket.remoteAddress || null;
router.use(authenticate);
router.use(tenantContext);

// GET /api/v1/organizations/current
router.get("/current", async (req: AuthRequest, res) => {
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, req.organization!.id)).limit(1);
    return res.json({ organization: org, userRole: req.organization!.role });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// PUT /api/v1/organizations/current
router.put("/current", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { name, logoUrl } = req.body;

    const [updated] = await db
      .update(organizations)
      .set({
        name: name || undefined,
        logoUrl: logoUrl || undefined,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, req.organization!.id))
      .returning();

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/organizations/api-key (Regenerate API Key)
router.post("/api-key", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const newApiKey = `acs_live_${crypto.randomBytes(32).toString("base64url")}`;
    const keyPrefix = newApiKey.slice(0, 17);
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000);
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.organizationId, req.organization!.id), isNull(apiKeys.revokedAt)));
    await db.insert(apiKeys).values({ organizationId: req.organization!.id, keyPrefix, keyHash: crypto.createHash("sha256").update(newApiKey).digest("hex"), name: "Default API key", scopes: ["*"], expiresAt });
    return res.status(201).json({ apiKey: newApiKey, keyPrefix, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/v1/organizations/members
router.get("/members", async (req: AuthRequest, res) => {
  try {
    const members = await db
      .select({
        id: organizationMembers.id,
        role: organizationMembers.role,
        createdAt: organizationMembers.createdAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, req.organization!.id));

    return res.json(members);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/current/dashboard-domains", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  const domains = await db.select({ id: organizationDashboardDomains.id, domain: organizationDashboardDomains.domain, verifiedAt: organizationDashboardDomains.verifiedAt, createdAt: organizationDashboardDomains.createdAt })
    .from(organizationDashboardDomains).where(eq(organizationDashboardDomains.organizationId, req.organization!.id));
  return res.json(domains);
});

router.post("/current/dashboard-domains", requireRole(["owner"]), async (req: AuthRequest, res) => {
  const domain = normalizeDashboardDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: "Invalid dashboard domain" });
  try {
    const verificationToken = newDashboardDomainVerificationToken();
    const [record] = await db.insert(organizationDashboardDomains).values({ organizationId: req.organization!.id, domain, verificationToken }).returning();
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "dashboard_domain.created", resourceType: "organization_dashboard_domain", resourceId: record.id, metadata: { domain }, ipAddress: ipOf(req) });
    return res.status(201).json({ id: record.id, domain, verification: { record: `_supportai.${domain}`, type: "TXT", value: `supportai-domain-verification=${verificationToken}` } });
  } catch (error) { return res.status(409).json({ error: "Dashboard domain is already registered" }); }
});

router.post("/current/dashboard-domains/:id/verify", requireRole(["owner"]), async (req: AuthRequest, res) => {
  const [record] = await db.select().from(organizationDashboardDomains).where(and(eq(organizationDashboardDomains.id, req.params.id), eq(organizationDashboardDomains.organizationId, req.organization!.id))).limit(1);
  if (!record) return res.status(404).json({ error: "Dashboard domain not found" });
  try {
    if (!await verifyDashboardDomain(record.domain, record.verificationToken)) return res.status(409).json({ error: "DNS_VERIFICATION_PENDING" });
  } catch { return res.status(409).json({ error: "DNS_VERIFICATION_PENDING" }); }
  const [verified] = await db.update(organizationDashboardDomains).set({ verifiedAt: new Date(), updatedAt: new Date() }).where(eq(organizationDashboardDomains.id, record.id)).returning();
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "dashboard_domain.verified", resourceType: "organization_dashboard_domain", resourceId: record.id, metadata: { domain: record.domain }, ipAddress: ipOf(req) });
  return res.json({ id: verified.id, domain: verified.domain, verifiedAt: verified.verifiedAt });
});

router.delete("/current/dashboard-domains/:id", requireRole(["owner"]), async (req: AuthRequest, res) => {
  const [record] = await db.delete(organizationDashboardDomains).where(and(eq(organizationDashboardDomains.id, req.params.id), eq(organizationDashboardDomains.organizationId, req.organization!.id))).returning();
  if (!record) return res.status(404).json({ error: "Dashboard domain not found" });
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "dashboard_domain.deleted", resourceType: "organization_dashboard_domain", resourceId: record.id, metadata: { domain: record.domain }, ipAddress: ipOf(req) });
  return res.status(204).end();
});

async function settingsFor(organizationId: string) {
  const [existing] = await db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(organizationSettings).values({ organizationId }).returning();
  return created;
}
const normalizeDomains = (value: unknown) => Array.isArray(value) ? [...new Set(value.map((domain) => typeof domain === "string" ? domain.trim().toLowerCase().replace(/^@/, "") : "").filter((domain) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)))].slice(0, 50) : [];

router.get("/current/auth-settings", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  const settings = await settingsFor(req.organization!.id);
  res.json({ localLoginEnabled: settings.localLoginEnabled, invitationEnabled: settings.invitationEnabled, ssoEnabled: settings.ssoEnabled, entraTenantId: settings.entraTenantId, entraClientId: settings.entraClientId, entraClientSecretConfigured: Boolean(settings.entraClientSecretEncrypted), allowedDomains: settings.allowedDomains, autoJoinEnabled: settings.autoJoinEnabled, defaultAutoJoinRole: settings.defaultAutoJoinRole, redirectUri: `${process.env.APP_PUBLIC_URL || ""}/api/v1/auth/entra/callback` });
});

router.patch("/current/auth-settings", requireRole(["owner"]), async (req: AuthRequest, res) => {
  const body = req.body || {};
  const allowedDomains = normalizeDomains(body.allowedDomains);
  const defaultAutoJoinRole = body.defaultAutoJoinRole;
  if (body.localLoginEnabled !== undefined && typeof body.localLoginEnabled !== "boolean" || body.invitationEnabled !== undefined && typeof body.invitationEnabled !== "boolean" || body.ssoEnabled !== undefined && typeof body.ssoEnabled !== "boolean" || body.autoJoinEnabled !== undefined && typeof body.autoJoinEnabled !== "boolean" || !["agent", "viewer"].includes(defaultAutoJoinRole ?? "agent") || (body.ssoEnabled && (typeof body.entraTenantId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.entraTenantId) || typeof body.entraClientId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.entraClientId)))) return res.status(400).json({ error: "Invalid authentication settings" });
  const current = await settingsFor(req.organization!.id);
  const [settings] = await db.update(organizationSettings).set({
    localLoginEnabled: body.localLoginEnabled ?? current.localLoginEnabled,
    invitationEnabled: body.invitationEnabled ?? current.invitationEnabled,
    ssoEnabled: body.ssoEnabled ?? current.ssoEnabled,
    entraTenantId: typeof body.entraTenantId === "string" ? body.entraTenantId.trim() : current.entraTenantId,
    entraClientId: typeof body.entraClientId === "string" ? body.entraClientId.trim() : current.entraClientId,
    entraClientSecretEncrypted: typeof body.entraClientSecret === "string" && body.entraClientSecret ? encryptSecret(body.entraClientSecret) : current.entraClientSecretEncrypted,
    allowedDomains,
    autoJoinEnabled: body.autoJoinEnabled ?? current.autoJoinEnabled,
    defaultAutoJoinRole: defaultAutoJoinRole ?? current.defaultAutoJoinRole,
    updatedAt: new Date(),
  }).where(eq(organizationSettings.id, current.id)).returning();
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "settings.authentication.update", resourceType: "organization_settings", resourceId: settings.id, metadata: { ssoEnabled: settings.ssoEnabled, autoJoinEnabled: settings.autoJoinEnabled, allowedDomains: settings.allowedDomains, clientSecretUpdated: Boolean(body.entraClientSecret) }, ipAddress: ipOf(req) });
  res.json({ localLoginEnabled: settings.localLoginEnabled, invitationEnabled: settings.invitationEnabled, ssoEnabled: settings.ssoEnabled, entraTenantId: settings.entraTenantId, entraClientId: settings.entraClientId, entraClientSecretConfigured: Boolean(settings.entraClientSecretEncrypted), allowedDomains: settings.allowedDomains, autoJoinEnabled: settings.autoJoinEnabled, defaultAutoJoinRole: settings.defaultAutoJoinRole });
});

const validRoles = new Set(["owner", "admin", "agent", "viewer"]);
const inviteToken = () => crypto.randomBytes(32).toString("base64url");
const hashInvite = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
router.use("/invitations", requireRole(["owner", "admin"]));
router.get("/invitations", async (req: AuthRequest, res) => {
  const invites = await db.select().from(organizationInvitations).where(eq(organizationInvitations.organizationId, req.organization!.id));
  res.json(invites.map(({ tokenHash, ...invite }) => ({ ...invite, status: invite.revokedAt ? "REVOKED" : invite.acceptedAt ? "ACCEPTED" : invite.expiresAt <= new Date() ? "EXPIRED" : "PENDING" })));
});
router.post("/invitations", async (req: AuthRequest, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : ""; const role = req.body?.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validRoles.has(role) || (role === "owner" && req.organization!.role !== "owner")) return res.status(400).json({ error: "Invalid invitation" });
  if (!(await settingsFor(req.organization!.id)).invitationEnabled) return res.status(403).json({ error: "INVITATIONS_DISABLED" });
  const rawToken = inviteToken(); const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  const [invite] = await db.insert(organizationInvitations).values({ organizationId: req.organization!.id, email, role, tokenHash: hashInvite(rawToken), invitedByUserId: req.user!.id, expiresAt }).returning();
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "invitation.created", resourceType: "organization_invitation", resourceId: invite.id, metadata: { email, role, expiresAt: expiresAt.toISOString() }, ipAddress: ipOf(req) });
  res.status(201).json({ id: invite.id, email, role, expiresAt, inviteUrl: `${process.env.APP_PUBLIC_URL || ""}/invite/${rawToken}` });
});
router.post("/invitations/:id/revoke", async (req: AuthRequest, res) => {
  const [invite] = await db.update(organizationInvitations).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(organizationInvitations.id, req.params.id), eq(organizationInvitations.organizationId, req.organization!.id), isNull(organizationInvitations.acceptedAt))).returning();
  if (!invite) return res.status(404).json({ error: "Invitation not found" }); await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "invitation.revoked", resourceType: "organization_invitation", resourceId: invite.id, ipAddress: ipOf(req) }); res.status(204).end();
});

/** Serialize owner changes per tenant. Counting owners outside this lock lets
 * two concurrent requests each remove a different final owner. */
async function changeMembershipSafely(organizationId: string, memberId: string, nextRole: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [organizationId]);
    const memberResult = await client.query("SELECT id, user_id, role FROM organization_members WHERE id = $1 AND organization_id = $2 FOR UPDATE", [memberId, organizationId]);
    const member = memberResult.rows[0] as { id: string; user_id: string; role: string } | undefined;
    if (!member) throw new Error("MEMBER_NOT_FOUND");
    if (member.role === "owner" && nextRole !== "owner") {
      const owners = await client.query("SELECT id FROM organization_members WHERE organization_id = $1 AND role = 'owner' AND status = 'active' FOR UPDATE", [organizationId]);
      if ((owners.rowCount ?? 0) <= 1) throw new Error("LAST_OWNER_REQUIRED");
    }
    if (nextRole === null) await client.query("DELETE FROM organization_members WHERE id = $1 AND organization_id = $2", [memberId, organizationId]);
    else await client.query("UPDATE organization_members SET role = $1 WHERE id = $2 AND organization_id = $3", [nextRole, memberId, organizationId]);
    await client.query("COMMIT");
    return member;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
router.patch("/members/:memberId", requireRole(["owner"]), async (req: AuthRequest, res) => {
  if (!validRoles.has(req.body?.role)) return res.status(400).json({ error: "Invalid role" });
  try {
    const member = await changeMembershipSafely(req.organization!.id, req.params.memberId, req.body.role);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "membership.role_changed", resourceType: "organization_member", resourceId: member.id, metadata: { oldRole: member.role, newRole: req.body.role }, ipAddress: ipOf(req) });
    return res.status(204).end();
  } catch (error) { return res.status((error as Error).message === "MEMBER_NOT_FOUND" ? 404 : (error as Error).message === "LAST_OWNER_REQUIRED" ? 409 : 500).json({ error: (error as Error).message }); }
});
router.delete("/members/:memberId", requireRole(["owner"]), async (req: AuthRequest, res) => {
  try {
    const member = await changeMembershipSafely(req.organization!.id, req.params.memberId, null);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "membership.removed", resourceType: "organization_member", resourceId: member.id, ipAddress: ipOf(req) });
    return res.status(204).end();
  } catch (error) { return res.status((error as Error).message === "MEMBER_NOT_FOUND" ? 404 : (error as Error).message === "LAST_OWNER_REQUIRED" ? 409 : 500).json({ error: (error as Error).message }); }
});

export default router;
