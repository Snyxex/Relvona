import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";

export class AuditService {
  static async logAction(data: {
    organizationId: string;
    actorUserId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: any;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    try {
      // Never log raw secrets, passwords, or tokens in audit logs
      const sanitizedMetadata = data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : {};
      if (sanitizedMetadata.password) delete sanitizedMetadata.password;
      if (sanitizedMetadata.apiKey) sanitizedMetadata.apiKey = "[REDACTED]";
      if (sanitizedMetadata.token) sanitizedMetadata.token = "[REDACTED]";

      await db.insert(auditLogs).values({
        organizationId: data.organizationId,
        actorUserId: data.actorUserId || null,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId || null,
        metadata: sanitizedMetadata,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
      });
    } catch (err) {
      console.error("Failed to write audit log entry:", (err as Error).message);
    }
  }
}
