import { Router } from "express";
import { count, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizations, users } from "../db/schema.js";
import { authenticate, AuthRequest, requirePlatformPermission } from "../middleware/auth.js";
import { PlatformOperationsService, PLATFORM_ORGANIZATION_STATUSES, type PlatformOrganizationStatus } from "../services/platformOperationsService.js";
import { getTwoFactorPolicy, setTwoFactorPolicy, TWO_FACTOR_POLICIES } from "../services/platformSecurityService.js";

const router = Router();
router.use(authenticate);
router.get("/access", requirePlatformPermission("platform.overview.view"), (req: AuthRequest, res) => {
  return res.json({ role: req.user!.platformRole, permissions: req.user!.platformPermissions });
});

const auditActor = (req: AuthRequest) => ({
  userId: req.user!.id,
  ipAddress: req.ip || req.socket.remoteAddress || null,
  userAgent: req.get("user-agent")?.slice(0, 1024) || null,
});

router.get("/security-settings", requirePlatformPermission("platform.security.view"), async (_req, res, next) => {
  try { return res.json({ twoFactorPolicy: await getTwoFactorPolicy() }); }
  catch (error) { return next(error); }
});

router.put("/security-settings", requirePlatformPermission("platform.security.manage"), async (req: AuthRequest, res, next) => {
  const policy = req.body?.twoFactorPolicy;
  if (!TWO_FACTOR_POLICIES.includes(policy)) return res.status(400).json({ error: "Ungültige 2FA-Richtlinie." });
  if (policy === "required" && !req.user!.twoFactorEnabled) {
    return res.status(409).json({ error: "Richte zuerst 2FA für dein eigenes Konto ein, bevor du sie verpflichtend machst.", code: "PLATFORM_ADMIN_2FA_REQUIRED" });
  }
  try {
    const settings = await setTwoFactorPolicy(policy, req.user!.id);
    return res.json({ twoFactorPolicy: settings.twoFactorPolicy });
  } catch (error) { return next(error); }
});

router.get("/overview", requirePlatformPermission("platform.overview.view"), async (_req, res, next) => {
  try {
    const [[organizationCount], [userCount], [activeOrganizationCount]] = await Promise.all([
      db.select({ value: count() }).from(organizations),
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(organizations).where(eq(organizations.status, "active")),
    ]);
    res.json({ organizations: Number(organizationCount.value), users: Number(userCount.value), activeOrganizations: Number(activeOrganizationCount.value) });
  } catch (error) { next(error); }
});

router.get("/organizations", requirePlatformPermission("platform.organizations.view"), async (_req, res, next) => {
  try { res.json(await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, plan: organizations.plan, status: organizations.status, createdAt: organizations.createdAt }).from(organizations).orderBy(organizations.name)); } catch (error) { next(error); }
});

router.get("/users", requirePlatformPermission("platform.users.view"), async (_req, res, next) => {
  try { res.json(await db.select({ id: users.id, name: users.name, email: users.email, status: users.status, systemRole: users.systemRole, createdAt: users.createdAt }).from(users).orderBy(users.createdAt)); } catch (error) { next(error); }
});

router.patch("/organizations/:id/status", requirePlatformPermission("platform.organizations.manage"), async (req: AuthRequest, res, next) => {
  const status: unknown = req.body?.status;
  if (typeof status !== "string" || !PLATFORM_ORGANIZATION_STATUSES.includes(status as PlatformOrganizationStatus) || !/^[0-9a-f-]{36}$/i.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid organization status or ID" });
  }
  try {
    const organization = await PlatformOperationsService.updateOrganizationStatus(req.params.id, status as PlatformOrganizationStatus, auditActor(req));
    if (!organization) return res.status(404).json({ error: "Organization not found" });
    return res.json(organization);
  } catch (error) { return next(error); }
});

router.post("/support-sessions", requirePlatformPermission("platform.support_sessions.manage"), async (req: AuthRequest, res, next) => {
  const organizationId = typeof req.body?.organizationId === "string" ? req.body.organizationId : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const durationMinutes = Number(req.body?.durationMinutes ?? 30);
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || reason.length < 5 || reason.length > 500 || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 30) return res.status(400).json({ error: "Invalid support access request" });
  try {
    const session = await PlatformOperationsService.startSupportSession(organizationId, reason, durationMinutes, auditActor(req));
    if (!session) return res.status(404).json({ error: "Organization not found" });
    return res.status(201).json(session);
  } catch (error) { return next(error); }
});

router.post("/support-sessions/:id/end", requirePlatformPermission("platform.support_sessions.manage"), async (req: AuthRequest, res, next) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid support session ID" });
  try {
    const ended = await PlatformOperationsService.endSupportSession(req.params.id, auditActor(req));
    if (!ended) return res.status(404).json({ error: "Support session not found" });
    return res.status(204).end();
  } catch (error) { return next(error); }
});

export default router;
