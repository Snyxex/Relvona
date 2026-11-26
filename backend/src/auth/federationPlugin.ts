import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie, deleteSessionCookie } from "better-auth/cookies";
import { createLocalJWKSet, jwtVerify } from "jose";
import { db, withTenantTransaction } from "../db/index.js";
import {
  organizations,
  organizationSettings,
  ssoLoginStates,
  organizationMembers,
  users,
} from "../db/schema.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { EntraAuthService } from "../services/entraAuthService.js";
import { ActiveDirectoryService } from "../services/activeDirectoryService.js";

import { createEntraPkce } from "./entraPkce.js";
import { discoverOidc, oidcRequest } from "./oidcHttp.js";
import { validateOidcClaims, validateOidcConfiguration } from "./oidcPolicy.js";
const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const origin = () =>
  new URL(process.env.APP_PUBLIC_URL || "http://localhost:3000").origin;
async function configuration(id: string) {
  return withTenantTransaction(id, async (tx) => {
    const [row] = await tx
      .select({ settings: organizationSettings, status: organizations.status })
      .from(organizations)
      .innerJoin(
        organizationSettings,
        eq(organizations.id, organizationSettings.organizationId),
      )
      .where(eq(organizations.id, id));
    if (!row || row.status !== "active") throw Error("SSO_NOT_ENABLED");
    return row.settings;
  });
}
export const federationPlugin = () =>
  ({
    id: "organization-federation",
    endpoints: {
      startOidc: createAuthEndpoint(
        "/oidc/:organizationId/start",
        { method: "GET" },
        async (ctx) => {
          try {
            const id = ctx.params.organizationId;
            if (!/^[0-9a-f-]{36}$/i.test(id))
              throw Error("SSO_INVALID_ORGANIZATION");
            const settings = await configuration(id);
            const config = validateOidcConfiguration(
              settings.oidcConfiguration,
            );
            if (!config.enabled) throw Error("SSO_NOT_ENABLED");
            const discovery = await discoverOidc(config.issuer),
              pkce = createEntraPkce(),
              state = crypto.randomBytes(32).toString("base64url");
            const nonce = crypto.randomBytes(32).toString("base64url");
            // Bind the attempt to the complete server-side configuration, including credentials.
            await db.insert(ssoLoginStates).values({
              organizationId: id,
              provider:
                "oidc:" + hash(JSON.stringify(settings.oidcConfiguration)),
              stateHash: hash(state),
              nonce,
              pkceVerifierEncrypted: encryptSecret(pkce.verifier),
              expiresAt: new Date(Date.now() + 600000),
            });
            const stateCookie = ctx.context.createAuthCookie("oidc_state", {
              maxAge: 600,
              sameSite: "lax",
            });
            await ctx.setSignedCookie(
              stateCookie.name,
              hash(state),
              ctx.context.secret,
              stateCookie.attributes,
            );
            const target = new URL(discovery.authorization_endpoint);
            target.search = new URLSearchParams({
              client_id: config.clientId,
              response_type: "code",
              scope: "openid profile email",
              redirect_uri: ctx.context.baseURL + "/oidc/callback",
              state,
              nonce,
              code_challenge: pkce.challenge,
              code_challenge_method: "S256",
            }).toString();
            throw ctx.redirect(target.toString());
          } catch (e) {
            if (
              e instanceof Response ||
              (e instanceof APIError && e.statusCode === 302)
            )
              throw e;
            throw ctx.redirect(origin() + "/#sso_error=SSO_START_FAILED");
          }
        },
      ),
      oidcCallback: createAuthEndpoint(
        "/oidc/callback",
        { method: "GET" },
        async (ctx) => {
          try {
            const state = ctx.query?.state,
              code = ctx.query?.code;
            if (
              typeof state !== "string" ||
              state.length > 512 ||
              typeof code !== "string" ||
              code.length > 4096
            )
              throw Error("SSO_INVALID_CALLBACK");
            const stateCookie = ctx.context.createAuthCookie("oidc_state", {
              sameSite: "lax",
            });
            if (
              (await ctx.getSignedCookie(
                stateCookie.name,
                ctx.context.secret,
              )) !== hash(state)
            )
              throw Error("SSO_BROWSER_STATE_INVALID");
            await ctx.setCookie(stateCookie.name, "", {
              ...stateCookie.attributes,
              maxAge: 0,
            });
            const [login] = await db
              .update(ssoLoginStates)
              .set({ consumedAt: new Date() })
              .where(
                and(
                  eq(ssoLoginStates.stateHash, hash(state)),
                  isNull(ssoLoginStates.consumedAt),
                  gt(ssoLoginStates.expiresAt, new Date()),
                ),
              )
              .returning();
            if (!login || !login.provider.startsWith("oidc:"))
              throw Error("SSO_INVALID_STATE");
            const settings = await configuration(login.organizationId),
              config = validateOidcConfiguration(settings.oidcConfiguration);
            if (
              !config.enabled ||
              login.provider !==
                "oidc:" + hash(JSON.stringify(settings.oidcConfiguration))
            )
              throw Error("SSO_CONFIGURATION_CHANGED");
            const discovery = await discoverOidc(config.issuer);
            const secret = (
              settings.oidcConfiguration as { clientSecretEncrypted?: string }
            ).clientSecretEncrypted;
            const tokens = await oidcRequest(
              discovery.token_endpoint,
              new URLSearchParams({
                client_id: config.clientId,
                client_secret: decryptSecret(secret || null) || "",
                code,
                grant_type: "authorization_code",
                redirect_uri: ctx.context.baseURL + "/oidc/callback",
                code_verifier: decryptSecret(login.pkceVerifierEncrypted) || "",
              }),
            );
            if (typeof tokens.id_token !== "string")
              throw Error("SSO_TOKEN_INVALID");
            const keys = createLocalJWKSet(
              await oidcRequest(discovery.jwks_uri),
            );
            const { payload } = await jwtVerify(tokens.id_token, keys, {
              issuer: config.issuer,
              audience: config.clientId,
              algorithms: ["RS256", "PS256", "ES256"],
              requiredClaims: ["sub", "exp", "iat"],
            });
            if (
              (payload.azp !== undefined && payload.azp !== config.clientId) ||
              (Array.isArray(payload.aud) &&
                payload.aud.length > 1 &&
                payload.azp !== config.clientId)
            )
              throw Error("SSO_AUDIENCE_INVALID");
            const identity = validateOidcClaims(
              payload,
              login.nonce,
              config.allowedDomains,
            );
            const userId = await EntraAuthService.resolveUserAndMembership({
              organizationId: login.organizationId,
              providerId: `oidc:${login.organizationId}:${hash(config.issuer + ":" + config.clientId)}`,
              accountId: identity.subject,
              issuer: config.issuer,
              email: identity.email,
              name: identity.name,
              idToken: tokens.id_token,
              autoJoinEnabled: false,
              defaultAutoJoinRole: "viewer",
            });
            const user = await ctx.context.internalAdapter.findUserById(userId);
            if (!user) throw Error("SSO_USER_NOT_FOUND");
            // Local MFA must never be bypassed by a custom session endpoint.
            const [local] = await db
              .select()
              .from(users)
              .where(eq(users.id, userId));
            if (local?.status !== "active") throw Error("SSO_USER_INACTIVE");
            if (local.twoFactorEnabled) {
              deleteSessionCookie(ctx, true);
              const identifier =
                  "2fa-" + crypto.randomBytes(20).toString("hex"),
                expiresAt = new Date(Date.now() + 600000);
              const cookie = ctx.context.createAuthCookie("two_factor", {
                maxAge: 600,
              });
              await ctx.context.internalAdapter.createVerificationValue({
                identifier,
                value: userId,
                expiresAt,
              });
              await ctx.context.internalAdapter.createVerificationValue({
                identifier: "2fa-attempts-" + identifier,
                value: "0",
                expiresAt,
              });
              await ctx.setSignedCookie(
                cookie.name,
                identifier,
                ctx.context.secret,
                cookie.attributes,
              );
              throw ctx.redirect(
                origin() +
                  "/?federation_mfa=1&organization=" +
                  encodeURIComponent(login.organizationId),
              );
            }
            const session =
              await ctx.context.internalAdapter.createSession(userId);
            if (!session) throw Error("SSO_SESSION_FAILED");
            await setSessionCookie(ctx, { session, user });
            throw ctx.redirect(
              origin() +
                "/?sso=completed&organization=" +
                encodeURIComponent(login.organizationId),
            );
          } catch (e) {
            if (
              e instanceof Response ||
              (e instanceof APIError && e.statusCode === 302)
            )
              throw e;
            throw ctx.redirect(origin() + "/#sso_error=SSO_LOGIN_FAILED");
          }
        },
      ),
      ldapLogin: createAuthEndpoint(
        "/ldap/sign-in",
        { method: "POST", requireHeaders: true },
        async (ctx) => {
          try {
            const body = ctx.body as {
              organizationId?: string;
              email?: string;
              password?: string;
            };
            if (
              typeof body?.organizationId !== "string" ||
              !/^[0-9a-f-]{36}$/i.test(body.organizationId) ||
              typeof body.email !== "string" ||
              body.email.length > 254 ||
              typeof body.password !== "string" ||
              !body.password ||
              body.password.length > 1024
            )
              throw Error("INVALID_LOGIN");
            const settings = await configuration(body.organizationId);
            // Directory passwords only authenticate already active, invited local identities.
            const [member] = await withTenantTransaction(
              body.organizationId,
              (tx) =>
                tx
                  .select({ userId: users.id })
                  .from(users)
                  .innerJoin(
                    organizationMembers,
                    eq(users.id, organizationMembers.userId),
                  )
                  .where(
                    and(
                      eq(users.email, body.email!.trim().toLowerCase()),
                      eq(
                        organizationMembers.organizationId,
                        body.organizationId!,
                      ),
                      eq(organizationMembers.status, "active"),
                    ),
                  ),
            );
            if (!member) throw Error("INVALID_LOGIN");
            const user = await ctx.context.internalAdapter.findUserById(
              member.userId,
            );
            const [local] = await db
              .select()
              .from(users)
              .where(eq(users.id, member.userId));
            if (!user || local?.status !== "active")
              throw Error("INVALID_LOGIN");
            if (
              !(await ActiveDirectoryService.authenticate(
                settings,
                body.email,
                body.password,
                body.organizationId,
              ))
            )
              throw Error("INVALID_LOGIN");
            if (local.twoFactorEnabled) {
              deleteSessionCookie(ctx, true);
              const identifier =
                  "2fa-" + crypto.randomBytes(20).toString("hex"),
                expiresAt = new Date(Date.now() + 600000);
              const cookie = ctx.context.createAuthCookie("two_factor", {
                maxAge: 600,
              });
              await ctx.context.internalAdapter.createVerificationValue({
                identifier,
                value: user.id,
                expiresAt,
              });
              await ctx.context.internalAdapter.createVerificationValue({
                identifier: "2fa-attempts-" + identifier,
                value: "0",
                expiresAt,
              });
              await ctx.setSignedCookie(
                cookie.name,
                identifier,
                ctx.context.secret,
                cookie.attributes,
              );
              return ctx.json({ twoFactorRedirect: true });
            }
            const session = await ctx.context.internalAdapter.createSession(
              user.id,
            );
            if (!session) throw Error("INVALID_LOGIN");
            await setSessionCookie(ctx, { session, user });
            return ctx.json({ success: true });
          } catch {
            return ctx.json(
              {
                error:
                  "Anmeldung fehlgeschlagen. Konto, Organisationskennung und MFA-Anforderungen prüfen.",
              },
              { status: 401 },
            );
          }
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
