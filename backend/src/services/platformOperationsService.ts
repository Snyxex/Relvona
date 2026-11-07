import { and, eq, isNull } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import { auditLogs, organizations, platformSupportSessions } from "../db/schema.js";

export const PLATFORM_ORGANIZATION_STATUSES = ["active", "suspended", "disabled"] as const;
export type PlatformOrganizationStatus = typeof PLATFORM_ORGANIZATION_STATUSES[number];
export type PlatformAuditActor = { userId: string; ipAddress?: string | null; userAgent?: string | null };

type AuditEvent = {
  organizationId: string;
  actor: PlatformAuditActor;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, string>;
};

async function writeRequiredAudit(tx: typeof db, event: AuditEvent): Promise<void> {
  // Privileged mutations MUST roll back if the tenant-scoped audit insert fails.
  await tx.insert(auditLogs).values({
    organizationId: event.organizationId,
    actorUserId: event.actor.userId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    metadata: event.metadata || {},
    ipAddress: event.actor.ipAddress || null,
    userAgent: event.actor.userAgent || null,
  });
}

export class PlatformOperationsService {
  static async updateOrganizationStatus(
    organizationId: string,
    status: PlatformOrganizationStatus,
    actor: PlatformAuditActor,
  ): Promise<{ id: string; status: string } | null> {
    return withTenantTransaction(organizationId, async (tx) => {
      const [organization] = await tx.update(organizations)
        .set({ status, updatedAt: new Date() })
        .where(eq(organizations.id, organizationId))
        .returning({ id: organizations.id, status: organizations.status });
      if (!organization) return null;

      await writeRequiredAudit(tx, {
        organizationId,
        actor,
        action: "platform.organization." + status,
        resourceType: "organization",
        resourceId: organization.id,
      });
      return organization;
    });
  }

  static async startSupportSession(
    organizationId: string,
    reason: string,
    durationMinutes: number,
    actor: PlatformAuditActor,
  ): Promise<{ id: string; organizationId: string; expiresAt: Date } | null> {
    return withTenantTransaction(organizationId, async (tx) => {
      const [organization] = await tx.select({ id: organizations.id })
        .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      if (!organization) return null;

      const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
      const [session] = await tx.insert(platformSupportSessions)
        .values({ platformAdminUserId: actor.userId, organizationId, reason, expiresAt })
        .returning({
          id: platformSupportSessions.id,
          organizationId: platformSupportSessions.organizationId,
          expiresAt: platformSupportSessions.expiresAt,
        });
      await writeRequiredAudit(tx, {
        organizationId,
        actor,
        action: "platform.support_access.started",
        resourceType: "platform_support_session",
        resourceId: session.id,
        metadata: { reason, expiresAt: expiresAt.toISOString() },
      });
      return session;
    });
  }

  static async endSupportSession(sessionId: string, actor: PlatformAuditActor): Promise<boolean> {
    const [current] = await db.select({ organizationId: platformSupportSessions.organizationId })
      .from(platformSupportSessions)
      .where(and(
        eq(platformSupportSessions.id, sessionId),
        eq(platformSupportSessions.platformAdminUserId, actor.userId),
        isNull(platformSupportSessions.endedAt),
      )).limit(1);
    if (!current) return false;

    return withTenantTransaction(current.organizationId, async (tx) => {
      // Recheck ownership and open state for concurrent termination attempts.
      const [session] = await tx.update(platformSupportSessions)
        .set({ endedAt: new Date() })
        .where(and(
          eq(platformSupportSessions.id, sessionId),
          eq(platformSupportSessions.platformAdminUserId, actor.userId),
          isNull(platformSupportSessions.endedAt),
        )).returning({ id: platformSupportSessions.id });
      if (!session) return false;
      await writeRequiredAudit(tx, {
        organizationId: current.organizationId,
        actor,
        action: "platform.support_access.ended",
        resourceType: "platform_support_session",
        resourceId: session.id,
      });
      return true;
    });
  }
}
