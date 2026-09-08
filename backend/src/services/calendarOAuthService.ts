import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import { calendarConnections } from "../db/extendedCustomerExperienceSchema.js";
import { calendarOAuthStates } from "../db/calendarOAuthSchema.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";

function b64url(buffer: Buffer) { return buffer.toString("base64url"); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest(); }
function stateHash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function safeRedirectAfter(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 300) return "/admin/settings/integrations";
  return value;
}

function callbackUrl(provider: "google" | "microsoft") {
  const base = process.env.BETTER_AUTH_URL || process.env.APP_PUBLIC_URL || "http://localhost:8080";
  return `${base.replace(/\/$/, "")}/api/v1/calendar-oauth/${provider}/callback`;
}

function providerConfig(provider: "google" | "microsoft") {
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google Calendar OAuth is not configured");
    return {
      clientId, clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"],
    };
  }
  const clientId = process.env.MICROSOFT_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  const tenant = process.env.MICROSOFT_CALENDAR_TENANT_ID || "common";
  if (!clientId || !clientSecret) throw new Error("Microsoft Calendar OAuth is not configured");
  return {
    clientId, clientSecret,
    authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    scopes: ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadWrite"],
  };
}

export class CalendarOAuthService {
  static async start(data: { organizationId: string; userId: string; provider: "google" | "microsoft"; redirectAfter?: unknown }) {
    const config = providerConfig(data.provider);
    const random = b64url(crypto.randomBytes(32));
    const state = `${data.organizationId}.${random}`;
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(sha256(verifier));
    await db.insert(calendarOAuthStates).values({
      organizationId: data.organizationId,
      userId: data.userId,
      provider: data.provider,
      stateHash: stateHash(state),
      codeVerifierEncrypted: encryptSecret(verifier)!,
      redirectAfter: safeRedirectAfter(data.redirectAfter),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: callbackUrl(data.provider),
      response_type: "code",
      scope: config.scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    if (data.provider === "google") {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
      params.set("include_granted_scopes", "true");
    }
    return { authorizationUrl: `${config.authorizeUrl}?${params.toString()}` };
  }

  static async callback(data: { provider: "google" | "microsoft"; state: unknown; code: unknown }) {
    if (typeof data.state !== "string" || typeof data.code !== "string" || data.code.length > 4096) throw new Error("Invalid OAuth callback");
    const organizationId = data.state.split(".")[0];
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) throw new Error("Invalid OAuth callback");
    const config = providerConfig(data.provider);

    return withTenantTransaction(organizationId, async (tx) => {
      const [stateRow] = await tx.select().from(calendarOAuthStates).where(and(
        eq(calendarOAuthStates.organizationId, organizationId),
        eq(calendarOAuthStates.provider, data.provider),
        eq(calendarOAuthStates.stateHash, stateHash(data.state as string)),
        isNull(calendarOAuthStates.usedAt),
        gt(calendarOAuthStates.expiresAt, new Date()),
      )).limit(1);
      if (!stateRow) throw new Error("OAuth state is invalid or expired");
      const [claimed] = await tx.update(calendarOAuthStates).set({ usedAt: new Date() }).where(and(
        eq(calendarOAuthStates.organizationId, organizationId),
        eq(calendarOAuthStates.id, stateRow.id),
        isNull(calendarOAuthStates.usedAt),
      )).returning();
      if (!claimed) throw new Error("OAuth state was already used");
      const verifier = decryptSecret(stateRow.codeVerifierEncrypted);
      if (!verifier) throw new Error("OAuth verifier is unavailable");

      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: data.code as string,
          redirect_uri: callbackUrl(data.provider),
          grant_type: "authorization_code",
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!tokenResponse.ok) throw new Error("Calendar OAuth token exchange failed");
      const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokens.access_token) throw new Error("Calendar OAuth token response is invalid");

      let externalAccountId: string | undefined;
      let credentials: Record<string, unknown>;
      if (data.provider === "google") {
        const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
        const profile = profileResponse.ok ? await profileResponse.json() as { sub?: string; email?: string } : {};
        externalAccountId = profile.email || profile.sub;
        credentials = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000, calendarId: "primary" };
      } else {
        const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
        if (!profileResponse.ok) throw new Error("Unable to resolve Microsoft Calendar account");
        const profile = await profileResponse.json() as { id?: string; mail?: string; userPrincipalName?: string };
        const email = profile.mail || profile.userPrincipalName;
        if (!email) throw new Error("Microsoft Calendar account has no mailbox email");
        externalAccountId = email;
        credentials = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000, userId: profile.id, email };
      }

      const [existing] = await tx.select().from(calendarConnections).where(and(
        eq(calendarConnections.organizationId, organizationId),
        eq(calendarConnections.userId, stateRow.userId),
        eq(calendarConnections.provider, data.provider),
      )).limit(1);
      if (existing) {
        await tx.update(calendarConnections).set({ externalAccountId, encryptedCredentials: encryptSecret(JSON.stringify(credentials)), status: "active", updatedAt: new Date() })
          .where(and(eq(calendarConnections.organizationId, organizationId), eq(calendarConnections.id, existing.id)));
      } else {
        await tx.insert(calendarConnections).values({ organizationId, userId: stateRow.userId, provider: data.provider, externalAccountId, encryptedCredentials: encryptSecret(JSON.stringify(credentials)), status: "active" });
      }
      return { organizationId, userId: stateRow.userId, provider: data.provider, redirectAfter: stateRow.redirectAfter || "/admin/settings/integrations" };
    });
  }
}
