import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { createRemoteJWKSet, jwtVerify } from "jose";
import crypto from "crypto";
import { decryptSecret } from "../utils/crypto.js";
import { EntraAuthService } from "../services/entraAuthService.js";

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

      try {
        const settings = await EntraAuthService.startConfiguration(organizationId);
        const state = random();
        const nonce = random();
        await EntraAuthService.createLoginState(organizationId, hash(state), nonce);

        const callback = `${ctx.context.baseURL}/entra/callback`;
        const authorize = new URL(`https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/authorize`);
        authorize.searchParams.set("client_id", settings.clientId);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("redirect_uri", callback);
        authorize.searchParams.set("response_mode", "query");
        authorize.searchParams.set("scope", "openid profile email");
        authorize.searchParams.set("state", state);
        authorize.searchParams.set("nonce", nonce);
        throw ctx.redirect(authorize.toString());
      } catch (error) {
        if (error instanceof Response) throw error;
        return ctx.json({ error: (error as Error).message }, { status: (error as Error).message === "SSO_NOT_ENABLED" ? 403 : 500 });
      }
    }),

    organizationEntraCallback: createAuthEndpoint("/entra/callback", { method: "GET" }, async (ctx) => {
      const code = typeof ctx.query?.code === "string" ? ctx.query.code : "";
      const state = typeof ctx.query?.state === "string" ? ctx.query.state : "";
      const fail = (reason: string) => ctx.redirect(`${frontendOrigin()}/#sso_error=${encodeURIComponent(reason)}`);
      if (!code || !state || state.length > 512) throw fail("SSO_INVALID_CALLBACK");

      try {
        const login = await EntraAuthService.consumeLoginState(hash(state));
        const callback = `${ctx.context.baseURL}/entra/callback`;
        const tokenResponse = await fetch(`https://login.microsoftonline.com/${login.tenantId}/oauth2/v2.0/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: login.clientId,
            client_secret: decryptSecret(login.clientSecretEncrypted) || "",
            code,
            grant_type: "authorization_code",
            redirect_uri: callback,
          }),
        });
        const tokens = await tokenResponse.json() as { id_token?: string; access_token?: string; refresh_token?: string; expires_in?: number };
        if (!tokenResponse.ok || !tokens.id_token) throw new Error("SSO_TOKEN_EXCHANGE_FAILED");

        const issuer = `https://login.microsoftonline.com/${login.tenantId}/v2.0`;
        const verified = await jwtVerify(
          tokens.id_token,
          createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${login.tenantId}/discovery/v2.0/keys`)),
          { issuer, audience: login.clientId },
        );
        const claims = verified.payload;
        const email = normalizedEmail(claims.email || claims.preferred_username);
        const objectId = typeof claims.oid === "string" ? claims.oid : null;
        if (!email || !objectId || claims.nonce !== login.nonce || typeof claims.tid !== "string" || claims.tid.toLowerCase() !== login.tenantId.toLowerCase()) {
          throw new Error("SSO_CLAIMS_INVALID");
        }
        const domain = email.split("@")[1];
        if (!login.allowedDomains.map((value) => value.toLowerCase()).includes(domain)) throw new Error("SSO_DOMAIN_NOT_ALLOWED");

        const userId = await EntraAuthService.resolveUserAndMembership({
          organizationId: login.organizationId,
          providerId: `entra:${login.organizationId}`,
          accountId: objectId,
          issuer,
          email,
          name: typeof claims.name === "string" ? claims.name : email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          accessTokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
          autoJoinEnabled: login.autoJoinEnabled,
          defaultAutoJoinRole: login.defaultAutoJoinRole,
        });

        const user = await ctx.context.internalAdapter.findUserById(userId);
        if (!user) throw new Error("SSO_USER_NOT_FOUND");
        const session = await ctx.context.internalAdapter.createSession(userId);
        if (!session) throw new Error("SSO_SESSION_CREATION_FAILED");
        await setSessionCookie(ctx, { session, user });
        throw ctx.redirect(`${frontendOrigin()}/?sso=completed&organization=${encodeURIComponent(login.organizationId)}`);
      } catch (error) {
        if (error instanceof Response) throw error;
        throw fail((error as Error).message.startsWith("SSO_") ? (error as Error).message : "SSO_VALIDATION_FAILED");
      }
    }),
  },
}) satisfies BetterAuthPlugin;
