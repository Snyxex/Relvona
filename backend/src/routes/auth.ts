import { Router } from "express";
import { AuthService } from "../services/authService.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { db, pool } from "../db/index.js";
import { users, organizationInvitations, organizationMembers, organizations } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../middleware/security.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

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
      const passwordHash = await bcrypt.hash(password, 12);
      const created = await client.query("INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1, $2, $3, true) RETURNING id", [invite.email.toLowerCase(), name, passwordHash]);
      userId = created.rows[0].id;
      await client.query("INSERT INTO auth_accounts (id, account_id, provider_id, issuer, user_id, password) VALUES ($1, $2, 'credential', 'local:credential', $3, $4)", [crypto.randomUUID(), userId, userId, passwordHash]);
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

// POST /api/v1/auth/register
router.post("/register", (_req, res) => res.status(403).json({ error: "PUBLIC_REGISTRATION_DISABLED" }));
router.get("/invitations/:token", createRateLimiter({ keyPrefix: "invite-lookup", limit: 20, windowMs: 60_000 }), async (req, res) => { try { const invite = await activeInvite(req.params.token); res.json({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt }); } catch { res.status(400).json({ error: "INVITATION_INVALID" }); } });
router.post("/invitations/:token/accept", createRateLimiter({ keyPrefix: "invite-accept", limit: 10, windowMs: 15 * 60_000 }), async (req, res) => {
  try {
    const invite = await activeInvite(req.params.token); const name = typeof req.body?.name === "string" ? req.body.name.trim() : ""; const password = req.body?.password;
    if (name.length < 2 || name.length > 100 || typeof password !== "string" || password.length < 12 || password.length > 256) return res.status(400).json({ error: "Invalid invitation acceptance" });
    await acceptInvitation(req.params.token, { id: "", email: invite.email }, name, password);
    // The browser signs in through Better Auth after this one-time invitation
    // transaction. No session token is ever returned from this endpoint.
    return res.status(201).json({ email: invite.email.toLowerCase() });
  } catch (error) { return res.status((error as Error).message === "LOGIN_REQUIRED" ? 409 : 400).json({ error: (error as Error).message }); }
});
router.post("/invitations/:token/accept-existing", authenticate, async (req: AuthRequest, res) => {
  try { await acceptInvitation(req.params.token, { id: req.user!.id, email: req.user!.email }); return res.status(204).end(); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
});

const base64url = (value: Buffer) => value.toString("base64url");
const normalizedEmail = (value: unknown) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const appUrl = () => {
  const value = process.env.APP_PUBLIC_URL || "http://localhost:3000";
  const parsed = new URL(value);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Invalid APP_PUBLIC_URL");
  return parsed.origin;
};

router.get("/entra/:organizationId/start", createRateLimiter({ keyPrefix: "entra-start", limit: 20, windowMs: 15 * 60_000 }), async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.organizationId)) return res.status(400).json({ error: "Invalid organization" });
  try {
    const config = await pool.query(`SELECT o.status, s.sso_enabled, s.entra_tenant_id, s.entra_client_id FROM organizations o JOIN organization_settings s ON s.organization_id = o.id WHERE o.id = $1`, [req.params.organizationId]);
    const settings = config.rows[0];
    if (!settings || settings.status !== "active" || !settings.sso_enabled || !settings.entra_tenant_id || !settings.entra_client_id) return res.status(403).json({ error: "SSO_NOT_ENABLED" });
    const state = base64url(crypto.randomBytes(32)); const nonce = base64url(crypto.randomBytes(32));
    await pool.query("INSERT INTO sso_login_states (organization_id, state_hash, nonce, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')", [req.params.organizationId, inviteHash(state), nonce]);
    const authorize = new URL(`https://login.microsoftonline.com/${settings.entra_tenant_id}/oauth2/v2.0/authorize`);
    authorize.searchParams.set("client_id", settings.entra_client_id); authorize.searchParams.set("response_type", "code"); authorize.searchParams.set("redirect_uri", `${appUrl()}/api/v1/auth/entra/callback`); authorize.searchParams.set("response_mode", "query"); authorize.searchParams.set("scope", "openid profile email"); authorize.searchParams.set("state", state); authorize.searchParams.set("nonce", nonce);
    res.redirect(302, authorize.toString());
  } catch (error) { res.status(500).json({ error: (error as Error).message }); }
});

router.get("/entra/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : ""; const state = typeof req.query.state === "string" ? req.query.state : "";
  const fail = (reason: string) => res.redirect(302, `${appUrl()}/#sso_error=${encodeURIComponent(reason)}`);
  if (!code || !state || state.length > 512) return fail("SSO_INVALID_CALLBACK");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stateResult = await client.query(`SELECT ss.*, s.sso_enabled, s.entra_tenant_id, s.entra_client_id, s.entra_client_secret_encrypted, s.auto_join_enabled, s.default_auto_join_role, s.allowed_domains, o.status FROM sso_login_states ss JOIN organization_settings s ON s.organization_id = ss.organization_id JOIN organizations o ON o.id = ss.organization_id WHERE ss.state_hash = $1 FOR UPDATE`, [inviteHash(state)]);
    const login = stateResult.rows[0];
    if (!login || login.consumed_at || new Date(login.expires_at) <= new Date() || !login.sso_enabled || login.status !== "active") { await client.query("ROLLBACK"); return fail("SSO_INVALID_STATE"); }
    await client.query("UPDATE sso_login_states SET consumed_at = now() WHERE id = $1", [login.id]);
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${login.entra_tenant_id}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: login.entra_client_id, client_secret: (await import("../utils/crypto.js")).decryptSecret(login.entra_client_secret_encrypted) || "", code, grant_type: "authorization_code", redirect_uri: `${appUrl()}/api/v1/auth/entra/callback` }) });
    const tokens = await tokenResponse.json() as { id_token?: string };
    if (!tokenResponse.ok || !tokens.id_token) { await client.query("ROLLBACK"); return fail("SSO_TOKEN_EXCHANGE_FAILED"); }
    const issuer = `https://login.microsoftonline.com/${login.entra_tenant_id}/v2.0`;
    const verified = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${login.entra_tenant_id}/discovery/v2.0/keys`)), { issuer, audience: login.entra_client_id });
    const claims = verified.payload; const email = normalizedEmail(claims.email || claims.preferred_username);
    if (!email || claims.nonce !== login.nonce || typeof claims.sub !== "string" || typeof claims.tid !== "string" || claims.tid.toLowerCase() !== String(login.entra_tenant_id).toLowerCase()) { await client.query("ROLLBACK"); return fail("SSO_CLAIMS_INVALID"); }
    const domain = email.split("@")[1]; const allowedDomains = Array.isArray(login.allowed_domains) ? login.allowed_domains : [];
    if (!allowedDomains.includes(domain)) { await client.query("ROLLBACK"); return fail("SSO_DOMAIN_NOT_ALLOWED"); }
    const identity = await client.query("SELECT user_id FROM user_external_identities WHERE provider = 'entra' AND issuer = $1 AND subject = $2", [issuer, claims.sub]);
    let userId = identity.rows[0]?.user_id as string | undefined;
    if (!userId) {
      const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rowCount) {
        // An identical email is not, by itself, enough to link a local account.
        // The account must already belong to this tenant or have an invitation
        // that proves the tenant administrator intended this association.
        const [membership, invitation] = await Promise.all([
          client.query("SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [login.organization_id, existing.rows[0].id]),
          client.query("SELECT id FROM organization_invitations WHERE organization_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()", [login.organization_id, email]),
        ]);
        if (!membership.rowCount && !invitation.rowCount) { await client.query("ROLLBACK"); return fail("SSO_ACCOUNT_LINKING_REQUIRED"); }
        userId = existing.rows[0].id;
      }
      else { const created = await client.query("INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id", [email, typeof claims.name === "string" ? claims.name.slice(0, 100) : email, await bcrypt.hash(base64url(crypto.randomBytes(32)), 10)]); userId = created.rows[0].id; }
      await client.query("INSERT INTO user_external_identities (user_id, provider, issuer, subject, email) VALUES ($1, 'entra', $2, $3, $4) ON CONFLICT (provider, issuer, subject) DO NOTHING", [userId, issuer, claims.sub, email]);
    }
    if (!userId) throw new Error("SSO_USER_CREATION_FAILED");
    const member = await client.query("SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2", [login.organization_id, userId]);
    if (!member.rowCount) {
      const invitation = await client.query("SELECT id, role FROM organization_invitations WHERE organization_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE", [login.organization_id, email]);
      if (invitation.rowCount) { await client.query("INSERT INTO organization_members (organization_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', now())", [login.organization_id, userId, invitation.rows[0].role]); await client.query("UPDATE organization_invitations SET accepted_at = now(), updated_at = now() WHERE id = $1", [invitation.rows[0].id]); }
      else if (login.auto_join_enabled && ["agent", "viewer"].includes(login.default_auto_join_role)) await client.query("INSERT INTO organization_members (organization_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', now())", [login.organization_id, userId, login.default_auto_join_role]);
      else { await client.query("ROLLBACK"); return fail("SSO_INVITATION_REQUIRED"); }
    }
    await client.query("INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, metadata) VALUES ($1, $2, 'sso.entra.login', 'user', $3)", [login.organization_id, userId, JSON.stringify({ email })]);
    await client.query("COMMIT");
    // Better Auth credentials are never replaced by a browser-visible JWT.
    // The organization-specific OIDC identity is now linked and audited; the
    // front end completes its Better Auth session through the normal provider
    // entry point instead of receiving a token in a URL fragment.
    res.redirect(302, `${appUrl()}/?sso=completed&organization=${encodeURIComponent(login.organization_id)}`);
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); return fail("SSO_VALIDATION_FAILED"); } finally { client.release(); }
});

// GET /api/v1/auth/me
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
