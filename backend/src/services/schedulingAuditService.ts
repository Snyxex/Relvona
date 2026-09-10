import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { auditLogs } from "../db/schema.js";

export const schedulingAuditActions = [
  "scheduling.calendar.disconnect",
  "scheduling.meeting_type.create",
  "scheduling.meeting_type.update",
  "scheduling.availability.create",
  "scheduling.availability.update",
  "scheduling.availability.delete",
  "scheduling.calendar_sync.retry",
  "scheduling.booking.create",
  "scheduling.booking.reschedule",
  "scheduling.booking.cancel",
] as const;

function safeLimit(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(Math.trunc(value), 100));
}

export class SchedulingAuditService {
  static async record(data: {
    organizationId: string;
    actorUserId?: string;
    action: (typeof schedulingAuditActions)[number];
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return withDatabaseTenantContext(async () => {
      setDatabaseTenant(data.organizationId);
      const [row] = await db.insert(auditLogs).values({
        organizationId: data.organizationId,
        actorUserId: data.actorUserId,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        metadata: data.metadata || {},
        ipAddress: data.ipAddress?.slice(0, 120),
        userAgent: data.userAgent?.slice(0, 500),
      }).returning();
      return row;
    });
  }

  static async list(organizationId: string, limit = 50) {
    return db.select().from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), inArray(auditLogs.action, [...schedulingAuditActions])))
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit(limit));
  }
}
