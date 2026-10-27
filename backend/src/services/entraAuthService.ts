import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import {
  auditLogs,
  authAccounts,
  organizationInvitations,
  organizationMembers,
  organizations,
  organizationSettings,
  ssoLoginStates,
  users,
} from "../db/schema.js";
import { LEGACY_PASSWORD_SENTINEL } from "../auth/password.js";
import { encryptSecret } from "../utils/crypto.js";

export type EntraLoginContext = {
  organizationId: string;
  nonce: string;
  pkceVerifierEncrypted: string;
  tenantId: string;
  clientId: string;
  clientSecretEncrypted: string;
  allowedDomains: string[];
  autoJoinEnabled: boolean;
  defaultAutoJoinRole: string;
};

export class EntraAuthService {
  static async startConfiguration(organizationId: string) {
    return withTenantTransaction(organizationId, async (tx) => {
      const [record] = await tx.select({
        organizationStatus: organizations.status,
        ssoEnabled: organizationSettings.ssoEnabled,
        tenantId: organizationSettings.entraTenantId,
        clientId: organizationSettings.entraClientId,
      }).from(organizations)
        .innerJoin(organizationSettings, eq(organizationSettings.organizationId, organizations.id))
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!record || record.organizationStatus !== "active" || !record.ssoEnabled || !record.tenantId || !record.clientId) throw new Error("SSO_NOT_ENABLED");
      return { tenantId: record.tenantId, clientId: record.clientId };
    });
  }

  static async createLoginState(organizationId: string, stateHash: string, nonce: string, pkceVerifier: string) {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(pkceVerifier)) throw new Error("SSO_INVALID_PKCE");
    const pkceVerifierEncrypted = encryptSecret(pkceVerifier);
    if (!pkceVerifierEncrypted) throw new Error("SSO_PKCE_STORAGE_FAILED");
    await db.insert(ssoLoginStates).values({
      organizationId, stateHash, nonce, pkceVerifierEncrypted,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  }

  static async consumeLoginState(stateHash: string): Promise<EntraLoginContext> {
    const now = new Date();
    const [state] = await db.update(ssoLoginStates)
      .set({ consumedAt: now })
      .where(and(eq(ssoLoginStates.stateHash, stateHash), isNull(ssoLoginStates.consumedAt), gt(ssoLoginStates.expiresAt, now)))
      .returning({ organizationId: ssoLoginStates.organizationId, nonce: ssoLoginStates.nonce,
        pkceVerifierEncrypted: ssoLoginStates.pkceVerifierEncrypted });
    if (!state) throw new Error("SSO_INVALID_STATE");
    // Pre-upgrade states do not have PKCE and must be restarted rather than downgraded.
    if (!state.pkceVerifierEncrypted) throw new Error("SSO_PKCE_REQUIRED");

    return withTenantTransaction(state.organizationId, async (tx) => {
      const [record] = await tx.select({
        organizationStatus: organizations.status,
        ssoEnabled: organizationSettings.ssoEnabled,
        tenantId: organizationSettings.entraTenantId,
        clientId: organizationSettings.entraClientId,
        clientSecretEncrypted: organizationSettings.entraClientSecretEncrypted,
        allowedDomains: organizationSettings.allowedDomains,
        autoJoinEnabled: organizationSettings.autoJoinEnabled,
        defaultAutoJoinRole: organizationSettings.defaultAutoJoinRole,
      }).from(organizations)
        .innerJoin(organizationSettings, eq(organizationSettings.organizationId, organizations.id))
        .where(eq(organizations.id, state.organizationId))
        .limit(1);

      if (!record || record.organizationStatus !== "active" || !record.ssoEnabled || !record.tenantId || !record.clientId || !record.clientSecretEncrypted) throw new Error("SSO_NOT_ENABLED");
      return {
        organizationId: state.organizationId,
        nonce: state.nonce,
        pkceVerifierEncrypted: state.pkceVerifierEncrypted,
        tenantId: record.tenantId,
        clientId: record.clientId,
        clientSecretEncrypted: record.clientSecretEncrypted,
        allowedDomains: Array.isArray(record.allowedDomains) ? record.allowedDomains.map(String) : [],
        autoJoinEnabled: record.autoJoinEnabled,
        defaultAutoJoinRole: record.defaultAutoJoinRole,
      };
    });
  }

  static async resolveUserAndMembership(input: {
    organizationId: string;
    providerId: string;
    accountId: string;
    issuer: string;
    email: string;
    name: string;
    accessToken?: string;
    refreshToken?: string;
    idToken: string;
    accessTokenExpiresAt?: Date;
    autoJoinEnabled: boolean;
    defaultAutoJoinRole: string;
  }) {
    return withTenantTransaction(input.organizationId, async (tx) => {
      const [existingAccount] = await tx.select({ userId: authAccounts.userId }).from(authAccounts)
        .where(and(eq(authAccounts.providerId, input.providerId), eq(authAccounts.accountId, input.accountId))).limit(1);
      let userId = existingAccount?.userId;

      if (!userId) {
        const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
        if (existingUser) {
          const [membership] = await tx.select({ id: organizationMembers.id }).from(organizationMembers)
            .where(and(eq(organizationMembers.organizationId, input.organizationId), eq(organizationMembers.userId, existingUser.id), eq(organizationMembers.status, "active"))).limit(1);
          const [invitation] = await tx.select({ id: organizationInvitations.id }).from(organizationInvitations)
            .where(and(eq(organizationInvitations.organizationId, input.organizationId), eq(organizationInvitations.email, input.email), isNull(organizationInvitations.acceptedAt), isNull(organizationInvitations.revokedAt), gt(organizationInvitations.expiresAt, new Date()))).limit(1);
          if (!membership && !invitation) throw new Error("SSO_ACCOUNT_LINKING_REQUIRED");
          userId = existingUser.id;
        } else {
          const [created] = await tx.insert(users).values({ email: input.email, name: input.name.slice(0, 100), passwordHash: LEGACY_PASSWORD_SENTINEL, emailVerified: true }).returning({ id: users.id });
          userId = created.id;
        }

        await tx.insert(authAccounts).values({
          id: crypto.randomUUID(), accountId: input.accountId, providerId: input.providerId, issuer: input.issuer, userId,
          accessToken: input.accessToken ?? null, refreshToken: input.refreshToken ?? null, idToken: input.idToken,
          accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
        }).onConflictDoNothing({ target: [authAccounts.providerId, authAccounts.accountId] });

        const [canonicalAccount] = await tx.select({ userId: authAccounts.userId }).from(authAccounts)
          .where(and(eq(authAccounts.providerId, input.providerId), eq(authAccounts.accountId, input.accountId))).limit(1);
        if (!canonicalAccount) throw new Error("SSO_ACCOUNT_CREATION_FAILED");
        userId = canonicalAccount.userId;
      }

      const [membership] = await tx.select({ id: organizationMembers.id, status: organizationMembers.status }).from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, input.organizationId), eq(organizationMembers.userId, userId))).limit(1);
      if (membership && membership.status !== "active") throw new Error("SSO_MEMBERSHIP_INACTIVE");

      if (!membership) {
        const [invitation] = await tx.select().from(organizationInvitations)
          .where(and(eq(organizationInvitations.organizationId, input.organizationId), eq(organizationInvitations.email, input.email), isNull(organizationInvitations.acceptedAt), isNull(organizationInvitations.revokedAt), gt(organizationInvitations.expiresAt, new Date()))).limit(1);
        if (invitation) {
          await tx.insert(organizationMembers).values({ organizationId: input.organizationId, userId, role: invitation.role, status: "active", joinedAt: new Date() });
          await tx.update(organizationInvitations).set({ acceptedAt: new Date(), updatedAt: new Date() }).where(and(eq(organizationInvitations.id, invitation.id), isNull(organizationInvitations.acceptedAt)));
        } else if (input.autoJoinEnabled && ["agent", "viewer"].includes(input.defaultAutoJoinRole)) {
          await tx.insert(organizationMembers).values({ organizationId: input.organizationId, userId, role: input.defaultAutoJoinRole, status: "active", joinedAt: new Date() });
        } else {
          throw new Error("SSO_INVITATION_REQUIRED");
        }
      }

      await tx.insert(auditLogs).values({ organizationId: input.organizationId, actorUserId: userId, action: "sso.entra.login", resourceType: "user", metadata: { providerId: input.providerId } });
      return userId;
    });
  }
}
