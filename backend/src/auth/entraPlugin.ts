import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { createRemoteJWKSet, jwtVerify } from "jose";
import crypto from "crypto";
import { pool } from "../db/index.js";
import { decryptSecret } from "../utils/crypto.js";
import { LEGACY_PASSWORD_SENTINEL } from "./password.js";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const random = () => crypto.randomBytes(32).toString("base64url");
const normalizedEmail = (value: unknown) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const frontendOrigin = () => {
  const url = new URL(process.env.APP_PUBLIC_URL || "http://localhost:3000");
  if (!/^https?:$/.test(url.protocol)) throw new Error("Invalid APP_PUBLIC_URL");
  return url.origin;
};

export const entraPlugin = () => ({
  id: "organization-entra",
  endpoints: {
    startOrganizationEntra: createAuthEndpoint("/entra/:organizationId/start", { method: "GET" }, async (ctx) => {
      const organizationId = ctx.params?.organizationId;
      if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) return ctx.json({ error: "Invalid organization" }, { status: 400 });

      const config = await pool.query(
        `SELECT o.status, s.sso_enabled, s.entra_tenant_id, s.entra_client_id
         FROM organizations o
         JOIN organization_settings s ON s.organization_id = o.id
         WHERE o.id = $1`,
        [organizationId],
      );
      const settings = config.rows[0];
      if (!settings || settings.status !== "active" || !settings.sso_enabled || !settings.entra_tenant_id || !settings.entra_client_id) {
        return ctx.json({ error: "SSO_NOT_ENABLED" }, { status: 403 });
      }

      const state = random();
      const nonce = random();
      await pool.query(
        "INSERT INTO sso_login_states (organization_id, state_hash, nonce, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')",
        [organizationId, hash(state), nonce],
      );

      const callback = `${ctx.context.baseURL}/entra/callback`;
      const authorize = new URL(`https://login.microsoftonline.com/${settings.entra_tenant_id}/oauth2/v2.0/authorize`);
      authorize.searchParams.set("client_id", settings.entra_client_id);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("redirect_uri", callback);
      authorize.searchParams.set("response_mode", "query");
      authorize.searchParams.set("scope", "openid profile email");
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("nonce", nonce);
      throw ctx.redirect(authorize.toString());
    }),

    organizationEntraCallback: createAuthEndpoint("/entra/callback", { method: "GET" }, async (ctx) => {
      const code = typeof ctx.query?.code === "string" ? ctx.query.code : "";
      const state = typeof ctx.query?.state === "string" ? ctx.query.state : "";
      const fail = (reason: string) => ctx.redirect(`${frontendOrigin()}/#sso_error=${encodeURIComponent(reason)}`);
      if (!code || !state || state.length > 512) throw fail("SSO_INVALID_CALLBACK");

      const client = await pool.connect();
      let userId = "";
      let organizationId = "";
      let providerId = "";
      let accountId = "";
      let email = "";
      try {
        await client.query("BEGIN");
        const stateResult = await client.query(
          `SELECT ss.*, s.sso_enabled, s.entra_tenant_id, s.entra_client_id,
                  s.entra_client_secret_encrypted, s.auto_join_enabled,
                  s.default_auto_join_role, s.allowed_domains, o.status
           FROM sso_login_states ss
           JOIN organization_settings s ON s.organization_id = ss.organization_id
           JOIN organizations o ON o.id = ss.organization_id
           WHERE ss.state_hash = $1 FOR UPDATE`,
          [hash(state)],
        );
        const login = stateResult.rows[0];
        if (!login || login.consumed_at || new Date(login.expires_at) <= new Date() || !login.sso_enabled || login.status !== "active") {
          await client.query("ROLLBACK");
          throw fail("SSO_INVALID_STATE");
        }
        await client.query("UPDATE sso_login_states SET consumed_at = now() WHERE id = $1", [login.id]);

        const callback = `${ctx.context.baseURL}/entra/callback`;
        const tokenResponse = await fetch(`https://login.microsoftonline.com/${login.entra_tenant_id}/oauth2/v2.0/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: login.entra_client_id,
            client_secret: decryptSecret(login.entra_client_secret_encrypted) || "",
            code,
            grant_type: "authorization_code",
            redirect_uri: callback,
          }),
        });
        const tokens = await tokenResponse.json() as { id_token?: string; access_token?: string; refresh_token?: string; expires_in?: number };
        if (!tokenResponse.ok || !tokens.id_token) {
          await client.query("ROLLBACK");
          throw fail("SSO_TOKEN_EXCHANGE_FAILED");
        }

        const issuer = `https://login.microsoftonline.com/${login.entra_tenant_id}/v2.0`;
        const verified = await jwtVerify(
          tokens.id_token,
          createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${login.entra_tenant_id}/discovery/v2.0/keys`)),
          { issuer, audience: login.entra_client_id },
        );
        const claims = verified.payload;
        const verifiedEmail = normalizedEmail(claims.email || claims.preferred_username);
        const stableObjectId = typeof claims.oid === "string" ? claims.oid : null;
        if (!verifiedEmail || !stableObjectId || claims.nonce !== login.nonce || typeof claims.tid !== "string" || claims.tid.toLowerCase() !== String(login.entra_tenant_id).toLowerCase()) {
          await client.query("ROLLBACK");
          throw fail("SSO_CLAIMS_INVALID");
        }

        const domain = verifiedEmail.split("@")[1];
        const allowedDomains = Array.isArray(login.allowed_domains) ? login.allowed_domains.map((value: unknown) => String(value).toLowerCase()) : [];
        if (!allowedDomains.includes(domain)) {
          await client.query("ROLLBACK");
          throw fail("SSO_DOMAIN_NOT_ALLOWED");
        }

        organizationId = login.organization_id;
        providerId = `entra:${organizationId}`;
        accountId = stableObjectId;
        email = verifiedEmail;

        const account = await client.query("SELECT user_id FROM auth_accounts WHERE provider_id = $1 AND account_id = $2", [providerId, accountId]);
        userId = account.rows[0]?.user_id || "";

        if (!userId) {
          const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
          if (existing.rowCount) {
            const [membership, invitation] = await Promise.all([
              client.query("SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [organizationId, existing.rows[0].id]),
              client.query("SELECT id FROM organization_invitations WHERE organization_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()", [organizationId, email]),
            ]);
            if (!membership.rowCount && !invitation.rowCount) {
              await client.query("ROLLBACK");
              throw fail("SSO_ACCOUNT_LINKING_REQUIRED");
            }
            userId = existing.rows[0].id;
          } else {
            const created = await client.query(
              "INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1, $2, $3, true) RETURNING id",
              [email, typeof claims.name === "string" ? claims.name.slice(0, 100) : email, LEGACY_PASSWORD_SENTINEL],
            );
            userId = created.rows[0].id;
          }

          await client.query(
            `INSERT INTO auth_accounts
             (id, account_id, provider_id, issuer, user_id, access_token, refresh_token, id_token, access_token_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::int IS NULL THEN NULL ELSE now() + ($9 * interval '1 second') END)
             ON CONFLICT (provider_id, account_id) DO NOTHING`,
            [crypto.randomUUID(), accountId, providerId, issuer, userId, tokens.access_token || null, tokens.refresh_token || null, tokens.id_token, tokens.expires_in ?? null],
          );
        }

        const membership = await client.query("SELECT id, status FROM organization_members WHERE organization_id = $1 AND user_id = $2", [organizationId, userId]);
        if (!membership.rowCount) {
          const invitation = await client.query(
            "SELECT id, role FROM organization_invitations WHERE organization_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE",
            [organizationId, email],
          );
          if (invitation.rowCount) {
            await client.query("INSERT INTO organization_members (organization_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', now())", [organizationId, userId, invitation.rows[0].role]);
            await client.query("UPDATE organization_invitations SET accepted_at = now(), updated_at = now() WHERE id = $1", [invitation.rows[0].id]);
          } else if (login.auto_join_enabled && ["agent", "viewer"].includes(login.default_auto_join_role)) {
            await client.query("INSERT INTO organization_members (organization_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', now())", [organizationId, userId, login.default_auto_join_role]);
          } else {
            await client.query("ROLLBACK");
            throw fail("SSO_INVITATION_REQUIRED");
          }
        } else if (membership.rows[0].status !== "active") {
          await client.query("ROLLBACK");
          throw fail("SSO_MEMBERSHIP_INACTIVE");
        }

        await client.query(
          "INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, metadata) VALUES ($1, $2, 'sso.entra.login', 'user', $3)",
          [organizationId, userId, JSON.stringify({ providerId })],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error instanceof Response) throw error;
        throw fail("SSO_VALIDATION_FAILED");
      } finally {
        client.release();
      }

      const user = await ctx.context.internalAdapter.findUserById(userId);
      if (!user) throw fail("SSO_USER_NOT_FOUND");
      const session = await ctx.context.internalAdapter.createSession(userId);
      if (!session) throw fail("SSO_SESSION_CREATION_FAILED");
      await setSessionCookie(ctx, { session, user });
      throw ctx.redirect(`${frontendOrigin()}/?sso=completed&organization=${encodeURIComponent(organizationId)}`);
    }),
  },
}) satisfies BetterAuthPlugin;
