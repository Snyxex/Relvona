import { Router } from "express";
import { AuthService } from "../services/authService.js";
import { InvitationService } from "../services/invitationService.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { users, organizationMembers, organizations } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../middleware/security.js";

const router = Router();

router.get("/bootstrap-status", async (_req, res) => res.json({ required: await AuthService.platformBootstrapRequired() }));
router.post("/setup/platform-admin", createRateLimiter({ keyPrefix: "platform-bootstrap", limit: 5, windowMs: 60 * 60_000, keyGenerator: req => req.ip }), async (req, res) => {
  const { name, email, password, passwordConfirmation } = req.body || {};
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100 || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 12 || password.length > 256 || password !== passwordConfirmation) return res.status(400).json({ error: "Invalid setup data" });
  try { return res.status(201).json(await AuthService.bootstrapPlatformAdmin({ name, email, password })); } catch (error) { return res.status((error as Error).message === "PLATFORM_ADMIN_ALREADY_EXISTS" ? 409 : 400).json({ error: (error as Error).message }); }
});

router.post("/register", (_req, res) => res.status(403).json({ error: "PUBLIC_REGISTRATION_DISABLED" }));
router.get("/invitations/:token", createRateLimiter({ keyPrefix: "invite-lookup", limit: 20, windowMs: 60_000 }), async (req, res) => {
  try {
    const invite = await InvitationService.getActive(req.params.token);
    return res.json({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt });
  } catch {
    return res.status(400).json({ error: "INVITATION_INVALID" });
  }
});
router.post("/invitations/:token/accept", createRateLimiter({ keyPrefix: "invite-accept", limit: 10, windowMs: 15 * 60_000 }), async (req, res) => {
  try {
    const invite = await InvitationService.getActive(req.params.token);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const password = req.body?.password;
    if (name.length < 2 || name.length > 100 || typeof password !== "string" || password.length < 12 || password.length > 256) return res.status(400).json({ error: "Invalid invitation acceptance" });
    const result = await InvitationService.accept(req.params.token, { email: invite.email }, { name, password });
    return res.status(201).json(result);
  } catch (error) {
    return res.status((error as Error).message === "LOGIN_REQUIRED" ? 409 : 400).json({ error: (error as Error).message });
  }
});
router.post("/invitations/:token/accept-existing", authenticate, async (req: AuthRequest, res) => {
  try {
    await InvitationService.accept(req.params.token, { id: req.user!.id, email: req.user!.email });
    return res.status(204).end();
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/entra/:organizationId/start", createRateLimiter({ keyPrefix: "entra-start", limit: 20, windowMs: 15 * 60_000 }), (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.organizationId)) return res.status(400).json({ error: "Invalid organization" });
  return res.redirect(307, `/api/auth/entra/${encodeURIComponent(req.params.organizationId)}/start`);
});
router.get("/entra/callback", (_req, res) => res.status(410).json({ error: "SSO_CALLBACK_MOVED", callback: "/api/auth/entra/callback" }));

router.get("/me", authenticate, async (req: AuthRequest, res) => res.json({ user: req.user }));

router.get("/organizations", authenticate, async (req: AuthRequest, res) => {
  const memberships = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: organizationMembers.role, organizationStatus: organizations.status, membershipStatus: organizationMembers.status }).from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId)).where(eq(organizationMembers.userId, req.user!.id));
  return res.json(memberships.filter((membership) => membership.organizationStatus === "active" && membership.membershipStatus === "active").map(({ organizationStatus, membershipStatus, ...membership }) => membership));
});

router.patch("/me/preferences", authenticate, async (req: AuthRequest, res) => {
  const { preferredLanguage, name, avatarUrl } = req.body || {};
  if (preferredLanguage !== undefined && !['de', 'en', 'es', 'fr'].includes(preferredLanguage)) return res.status(400).json({ error: "Unsupported preferred language" });
  if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100)) return res.status(400).json({ error: "Name must contain between 2 and 100 characters" });
  const validAvatar = avatarUrl === null || (typeof avatarUrl === "string" && avatarUrl.length <= 1_500_000 && (/^https:\/\//.test(avatarUrl) || /^data:image\/(png|jpe?g|webp);base64,/.test(avatarUrl)));
  if (avatarUrl !== undefined && !validAvatar) return res.status(400).json({ error: "Profile image must be an HTTPS URL or a PNG, JPEG, or WebP image up to 1 MB" });
  const [user] = await db.update(users).set({ preferredLanguage: preferredLanguage ?? undefined, name: typeof name === "string" ? name.trim() : undefined, avatarUrl: avatarUrl === undefined ? undefined : avatarUrl, updatedAt: new Date() }).where(eq(users.id, req.user!.id)).returning();
  return res.json({ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, preferredLanguage: user.preferredLanguage, isPlatformAdmin: req.user!.isPlatformAdmin, systemRole: req.user!.systemRole });
});

export default router;
