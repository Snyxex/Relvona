import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import {
  auditLogs,
  authAccounts,
  organizationInvitations,
  organizationMembers,
  organizations,
  organizationSettings,
  users,
} from "../db/schema.js";
import { hashPassword, LEGACY_PASSWORD_SENTINEL } from "../auth/password.js";

const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export class InvitationService {
  static async getActive(token: string) {
    const hash = tokenHash(token);
    const [record] = await db
      .select({ invite: organizationInvitations, organizationStatus: organizations.status })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
      .where(eq(organizationInvitations.tokenHash, hash))
      .limit(1);

    const invite = record?.invite;
    if (!invite) throw new Error("INVITATION_INVALID");
    if (invite.revokedAt) throw new Error("INVITATION_REVOKED");
    if (invite.acceptedAt) throw new Error("INVITATION_ALREADY_ACCEPTED");
    if (invite.expiresAt <= new Date()) throw new Error("INVITATION_EXPIRED");
    if (record.organizationStatus !== "active") throw new Error("ORGANIZATION_SUSPENDED");
    return invite;
  }

  static async accept(token: string, identity: { id?: string; email: string }, profile?: { name: string; password: string }) {
    const preflight = await this.getActive(token);
    const hash = tokenHash(token);

    return withTenantTransaction(preflight.organizationId, async (tx) => {
      // Row locking is intentionally the only raw SQL in this flow: invitation
      // acceptance must be single-consumer under concurrent requests.
      await tx.execute(sql`SELECT id FROM organization_invitations WHERE token_hash = ${hash} FOR UPDATE`);

      const [record] = await tx
        .select({
          invite: organizationInvitations,
          organizationStatus: organizations.status,
          invitationEnabled: organizationSettings.invitationEnabled,
        })
        .from(organizationInvitations)
        .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
        .leftJoin(organizationSettings, eq(organizationSettings.organizationId, organizationInvitations.organizationId))
        .where(eq(organizationInvitations.tokenHash, hash))
        .limit(1);

      const invite = record?.invite;
      if (!invite) throw new Error("INVITATION_INVALID");
      if (invite.organizationId !== preflight.organizationId) throw new Error("INVITATION_TENANT_MISMATCH");
      if (invite.revokedAt) throw new Error("INVITATION_REVOKED");
      if (invite.acceptedAt) throw new Error("INVITATION_ALREADY_ACCEPTED");
      if (invite.expiresAt <= new Date()) throw new Error("INVITATION_EXPIRED");
      if (record.organizationStatus !== "active") throw new Error("ORGANIZATION_SUSPENDED");
      if (record.invitationEnabled === false) throw new Error("INVITATIONS_DISABLED");
      if (invite.email.toLowerCase() !== identity.email.toLowerCase()) throw new Error("INVITATION_EMAIL_MISMATCH");

      let userId = identity.id;
      if (!userId) {
        if (!profile?.name || !profile.password) throw new Error("INVALID_INVITATION_ACCEPTANCE");
        const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, invite.email.toLowerCase())).limit(1);
        if (existing) throw new Error("LOGIN_REQUIRED");

        const credentialHash = await hashPassword(profile.password);
        const [created] = await tx.insert(users).values({
          email: invite.email.toLowerCase(),
          name: profile.name,
          passwordHash: LEGACY_PASSWORD_SENTINEL,
          emailVerified: true,
        }).returning({ id: users.id });
        userId = created.id;
        await tx.insert(authAccounts).values({
          id: crypto.randomUUID(),
          accountId: userId,
          providerId: "credential",
          issuer: "local:credential",
          userId,
          password: credentialHash,
        });
      }

      const [existingMembership] = await tx.select({ id: organizationMembers.id }).from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, invite.organizationId), eq(organizationMembers.userId, userId)))
        .limit(1);
      if (existingMembership) throw new Error("MEMBERSHIP_ALREADY_EXISTS");

      await tx.insert(organizationMembers).values({
        organizationId: invite.organizationId,
        userId,
        role: invite.role,
        status: "active",
        joinedAt: new Date(),
      });
      await tx.update(organizationInvitations).set({ acceptedAt: new Date(), updatedAt: new Date() }).where(eq(organizationInvitations.id, invite.id));
      await tx.insert(auditLogs).values({
        organizationId: invite.organizationId,
        actorUserId: userId,
        action: "invitation.accepted",
        resourceType: "organization_invitation",
        resourceId: invite.id,
        metadata: { role: invite.role },
      });

      return { email: invite.email.toLowerCase() };
    });
  }
}
