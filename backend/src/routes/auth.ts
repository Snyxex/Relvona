import { Router } from "express";
import { AuthService } from "../services/authService.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { db, pool } from "../db/index.js";
import { users, organizationInvitations, organizationMembers, organizations } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../middleware/security.js";
import crypto from "crypto";
import { hashPassword, LEGACY_PASSWORD_SENTINEL } from "../auth/password.js";

const router = Router();
const inviteHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const activeInvite = async (token: string) => { const [invite] = await db.select().from(organizationInvitations).where(eq(organizationInvitations.tokenHash, inviteHash(token))).limit(1); if (!invite) throw new Error("INVITATION_INVALID"); if (invite.revokedAt) throw new Error("INVITATION_REVOKED"); if (invite.acceptedAt) throw new Error("INVITATION_ALREADY_ACCEPTED"); if (invite.expiresAt <= new Date()) throw new Error("INVITATION_EXPIRED"); const [organization] = await db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, invite.organizationId)).limit(1); if (!organization || organization.status !== "active") throw new Error("ORGANIZATION_SUSPENDED"); return invite; };

async function acceptInvitation(token: string, user: { id: string; email: string }, name?: string, password?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tokenHash = inviteHash(token);
    const result = await client.query(`SELECT i.*, o.status AS organization_status, s.invitation_enabled FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id LEFT JOIN organization_settings s ON s.organization_id = i.organization_id WHERE i.token_hash = $1 FOR UPDATE`, [tokenHash]);
    const invite = result.rows[0];
    if (!invite) throw new Error("INVITATION_INVALID");
    if (invite.revoked_at) throw new Error("INVITATION_REVOKED");
    if (invite.accepted_at) throw new Error("INVITATION_ALREADY_ACCEPTED");
    if (new Date(invite.expires_at) <= new Date()) throw new Error("INVITATION_EXPIRED");
    if (invite.organization_status !== "active") throw new Error("ORGANIZATION_SUSPENDED");
    if (invite.invitation_enabled === false) throw new Error("INVITATIONS_DISABLED");
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) throw new Error("INVITATION_EMAIL_MISMATCH");
    let userId = user.id;
    if (!userId) {
      if (!name || !password) throw new Error("INVALID_INVITATION_ACCEPTANCE");
      const existing = await client.query("SELECT id FROM users WHERE email = $1", [invite.email.toLowerCase()]);
      if (existing.rowCount) throw new Error("LOGIN_REQUIRED");
      const credentialHash = await hashPassword(password);
      const created = await client.query("INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1, $2, $3, true) RETURNING id", [invite.email.toLowerCase(), name, LEGACY_PASSWORD_SENTINEL]);
      userId = created.rows[0].id;
      await client.query("INSERT INTO auth_accounts (id, account_id, provider_id, issuer, user_id, password) VALUES ($1, $2, 'credential', 'local:credential', $3, $4)", [crypto.randomUUID(), userId, userId, credentialHash]);
    }
    const membership = await client.query("INSERT INTO organization_members (organization_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', now()) ON CONFLICT (organization_id, user_id) DO NOTHING RETURNING id", [invite.organization_id, userId, invite.role]);
    if (!membership.rowCount) throw new Error("MEMBERSHIP_ALREADY_EXISTS");
    await client.query("UPDATE organization_invitations SET accepted_at = now(), updated_at = now() WHERE id = $1", [invite.id]);
    await client.query("INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1, $2, 'invitation.accepted', 'organization_invitation', $3, $4)", [invite.organization_id, userId, invite.id, JSON.stringify({ role: invite.role })]);
    await client.query("COMMIT");
    return { email: invite.email.toLowerCase() };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

router.get("/bootstrap-status", async (_req, res) => res.json({ required: await AuthService.platformBootstrapRequired() }));
router.post("/setup/platform-admin", createRateLimiter({ keyPrefix: "platform-bootstrap", limit: 5, windowMs: 60 * 60_000, keyGenerator: req => req.ip }), async (req, res) => {
  const { name, email, password, passwordConfirmation } = req.body || {};
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100 || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 12 || password.length > 256 || password !== passwordConfirmation) return res.status(400).json({ error: "Invalid setup data" });
  try { return res.status(201).json(await AuthService.bootstrapPlatformAdmin({ name, email, password })); } catch (error) { return res.status((error as Error).message === "PLATFORM_ADMIN_ALREADY_EXISTS" ? 409 : 400).json({ error: (error as Error).message }); }
});

router.post("/register", (_req, res) => res.status(403).json({ error: "PUBLIC_REGISTRATION_DISABLED" }));
router.get("/invitations/:token", createRateLimiter({ keyPrefix: "invite-lookup", limit: 20, windowMs: 60_000 }), async (req, res) => { try { const invite = await activeInvite(req.params.token); res.json({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt }); } catch { res.status(400).json({ error: "INVITATION_INVALID" }); } });
router.post("/invitations/:token/accept", createRateLimiter({ keyPrefix: "invite-accept", limit: 10, windowMs: 15 * 60_000 }), async (req, res) => {
  try {
    const invite = await activeInvite(req.params.token); const name = typeof req.body?.name === "string" ? req.body.name.trim() : ""; const password = req.body?.password;
    if (name.length < 2 || name.length > 100 || typeof password !== "string" || password.length < 12 || password.length > 256) return res.status(400).json({ error: "Invalid invitation acceptance" });
    await acceptInvitation(req.params.token, { id: "", email: invite.email }, name, password);
    return res.status(201).json({ email: invite.email.toLowerCase() });
  } catch (error) { return res.status((error as Error).message === "LOGIN_REQUIRED" ? 409 : 400).json({ error: (error as Error).message }); }
});
router.post("/invitations/:token/accept-existing", authenticate, async (req: AuthRequest, res) => {
  try { await acceptInvitation(req.params.token, { id: req.user!.id, email: req.user!.email }); return res.status(204).end(); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
});

// Compatibility entry point for existing frontend links. The actual Entra
// authentication endpoints now live inside Better Auth at /api/auth/entra/*.
router.get("/entra/:organizationId/start", createRateLimiter({ keyPrefix: "entra-start", limit: 20, windowMs: 15 * 60_000 }), (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.organizationId)) return res.status(400).json({ error: "Invalid organization" });
  return res.redirect(307, `/api/auth/entra/${encodeURIComponent(req.params.organizationId)}/start`);
});

// Old callbacks must not continue to execute a second authentication stack.
router.get("/entra/callback", (_req, res) => res.status(410).json({
  error: "SSO_CALLBACK_MOVED",
  callback: "/api/auth/entra/callback",
}));

router.get("/me", authenticate, async (req: AuthRequest, res) => {
  return res.json({ user: req.user });
});

router.get("/organizations", authenticate, async (req: AuthRequest, res) => {
  const memberships = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: organizationMembers.role, organizationStatus: organizations.status, membershipStatus: organizationMembers.status }).from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId)).where(eq(organizationMembers.userId, req.user!.id));
  return res.json(memberships.filter((membership) => membership.organizationStatus === "active" && membership.membershipStatus === "active").map(({ organizationStatus, membershipStatus, ...membership }) => membership));
});

router.patch("/me/preferences", authenticate, async (req: AuthRequest, res) => {
  const { preferredLanguage, name, avatarUrl } = req.body || {};
  if (preferredLanguage !== undefined && !['de', 'en', 'es', 'fr'].includes(preferredLanguage)) {
    return res.status(400).json({ error: "Unsupported preferred language" });
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100)) {
    return res.status(400).json({ error: "Name must contain between 2 and 100 characters" });
  }
  const validAvatar = avatarUrl === null || (typeof avatarUrl === "string" && avatarUrl.length <= 1_500_000 && (/^https:\/\//.test(avatarUrl) || /^data:image\/(png|jpe?g|webp);base64,/.test(avatarUrl)));
  if (avatarUrl !== undefined && !validAvatar) {
    return res.status(400).json({ error: "Profile image must be an HTTPS URL or a PNG, JPEG, or WebP image up to 1 MB" });
  }
  const [user] = await db.update(users).set({
    preferredLanguage: preferredLanguage ?? undefined,
    name: typeof name === "string" ? name.trim() : undefined,
    avatarUrl: avatarUrl === undefined ? undefined : avatarUrl,
    updatedAt: new Date(),
  }).where(eq(users.id, req.user!.id)).returning();
  return res.json({ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, preferredLanguage: user.preferredLanguage, systemRole: user.systemRole });
});

export default router;
