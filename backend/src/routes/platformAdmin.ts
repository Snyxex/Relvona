import { Router } from "express";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLogs, organizations, platformSupportSessions, users } from "../db/schema.js";
import { authenticate, AuthRequest, requirePlatformAdmin } from "../middleware/auth.js";
import { AuditService } from "../services/auditService.js";

const router = Router();
router.use(authenticate, requirePlatformAdmin);
const ipOf = (req: AuthRequest) => req.ip || req.socket.remoteAddress || null;

router.get("/overview", async (_req, res, next) => {
  try {
    const [[organizationCount], [userCount], [activeOrganizationCount]] = await Promise.all([
      db.select({ value: count() }).from(organizations),
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(organizations).where(eq(organizations.status, "active")),
    ]);
    res.json({ organizations: Number(organizationCount.value), users: Number(userCount.value), activeOrganizations: Number(activeOrganizationCount.value) });
  } catch (error) { next(error); }
});

router.get("/organizations", async (_req, res, next) => {
  try { res.json(await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, plan: organizations.plan, status: organizations.status, createdAt: organizations.createdAt }).from(organizations).orderBy(organizations.name)); } catch (error) { next(error); }
});

router.get("/users", async (_req, res, next) => {
  try { res.json(await db.select({ id: users.id, name: users.name, email: users.email, status: users.status, systemRole: users.systemRole, createdAt: users.createdAt }).from(users).orderBy(users.createdAt)); } catch (error) { next(error); }
});

router.patch("/organizations/:id/status", async (req: AuthRequest, res, next) => {
  const status = req.body?.status;
  if (!['active', 'suspended', 'disabled'].includes(status)) return res.status(400).json({ error: "Invalid organization status" });
  try {
    const [organization] = await db.update(organizations).set({ status, updatedAt: new Date() }).where(eq(organizations.id, req.params.id)).returning();
    if (!organization) return res.status(404).json({ error: "Organization not found" });
    await AuditService.logAction({ organizationId: organization.id, actorUserId: req.user!.id, action: `platform.organization.${status}`, resourceType: "organization", resourceId: organization.id, ipAddress: ipOf(req) });
    res.json({ id: organization.id, status: organization.status });
  } catch (error) { next(error); }
});

router.post("/support-sessions", async (req: AuthRequest, res, next) => {
  const organizationId = typeof req.body?.organizationId === "string" ? req.body.organizationId : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const durationMinutes = Number(req.body?.durationMinutes ?? 30);
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || reason.length < 5 || reason.length > 500 || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 30) return res.status(400).json({ error: "Invalid support access request" });
  try {
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!organization) return res.status(404).json({ error: "Organization not found" });
    const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
    const [session] = await db.insert(platformSupportSessions).values({ platformAdminUserId: req.user!.id, organizationId, reason, expiresAt }).returning();
    await AuditService.logAction({ organizationId, actorUserId: req.user!.id, action: "platform.support_access.started", resourceType: "platform_support_session", resourceId: session.id, metadata: { reason, expiresAt: expiresAt.toISOString() }, ipAddress: ipOf(req) });
    res.status(201).json({ id: session.id, organizationId, expiresAt });
  } catch (error) { next(error); }
});

router.post("/support-sessions/:id/end", async (req: AuthRequest, res, next) => {
  try {
    const [session] = await db.update(platformSupportSessions).set({ endedAt: new Date() }).where(and(eq(platformSupportSessions.id, req.params.id), eq(platformSupportSessions.platformAdminUserId, req.user!.id), isNull(platformSupportSessions.endedAt))).returning();
    if (!session) return res.status(404).json({ error: "Support session not found" });
    await AuditService.logAction({ organizationId: session.organizationId, actorUserId: req.user!.id, action: "platform.support_access.ended", resourceType: "platform_support_session", resourceId: session.id, ipAddress: ipOf(req) });
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
