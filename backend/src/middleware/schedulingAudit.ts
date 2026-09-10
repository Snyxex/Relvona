import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth.js";
import { SchedulingAuditService } from "../services/schedulingAuditService.js";

type AuditTarget = { action: Parameters<typeof SchedulingAuditService.record>[0]["action"]; resourceType: string; resourceId?: string };

function resolveTarget(req: AuthRequest): AuditTarget | undefined {
  const method = req.method.toUpperCase();
  const path = req.path;
  const id = typeof req.params?.id === "string" ? req.params.id : undefined;

  if (method === "DELETE" && /^\/connections\/[^/]+$/.test(path)) return { action: "scheduling.calendar.disconnect", resourceType: "calendar_connection", resourceId: id };
  if (method === "POST" && path === "/meeting-types") return { action: "scheduling.meeting_type.create", resourceType: "meeting_type" };
  if (method === "PATCH" && /^\/meeting-types\/[^/]+$/.test(path)) return { action: "scheduling.meeting_type.update", resourceType: "meeting_type", resourceId: id };
  if (method === "POST" && path === "/availability") return { action: "scheduling.availability.create", resourceType: "availability_rule" };
  if (method === "PATCH" && /^\/availability\/[^/]+$/.test(path)) return { action: "scheduling.availability.update", resourceType: "availability_rule", resourceId: id };
  if (method === "DELETE" && /^\/availability\/[^/]+$/.test(path)) return { action: "scheduling.availability.delete", resourceType: "availability_rule", resourceId: id };
  if (method === "POST" && /^\/bookings\/[^/]+\/calendar-sync\/retry$/.test(path)) return { action: "scheduling.calendar_sync.retry", resourceType: "booking", resourceId: id };
  if (method === "POST" && path === "/bookings") return { action: "scheduling.booking.create", resourceType: "booking" };
  if (method === "POST" && /^\/bookings\/[^/]+\/reschedule$/.test(path)) return { action: "scheduling.booking.reschedule", resourceType: "booking", resourceId: id };
  if (method === "POST" && /^\/bookings\/[^/]+\/cancel$/.test(path)) return { action: "scheduling.booking.cancel", resourceType: "booking", resourceId: id };
  return undefined;
}

export function auditSchedulingMutation(req: AuthRequest, res: Response, next: NextFunction) {
  const target = resolveTarget(req);
  if (!target) return next();

  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !req.organization?.id) return;
    void SchedulingAuditService.record({
      organizationId: req.organization.id,
      actorUserId: req.user?.id,
      ...target,
      metadata: {
        method: req.method,
        path: req.path,
        role: req.organization.role,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    }).catch((error) => console.error("[Scheduling Audit] Failed to persist audit entry:", (error as Error).message));
  });
  next();
}
