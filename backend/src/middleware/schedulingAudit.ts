import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth.js";
import { SchedulingAuditService } from "../services/schedulingAuditService.js";

type AuditTarget = { action: Parameters<typeof SchedulingAuditService.record>[0]["action"]; resourceType: string; resourceId?: string };

function matchId(path: string, pattern: RegExp) {
  return path.match(pattern)?.[1];
}

function resolveTarget(req: AuthRequest): AuditTarget | undefined {
  const method = req.method.toUpperCase();
  const path = req.path;

  const connectionId = matchId(path, /^\/connections\/([^/]+)$/);
  if (method === "DELETE" && connectionId) return { action: "scheduling.calendar.disconnect", resourceType: "calendar_connection", resourceId: connectionId };
  if (method === "POST" && path === "/meeting-types") return { action: "scheduling.meeting_type.create", resourceType: "meeting_type" };
  const meetingTypeId = matchId(path, /^\/meeting-types\/([^/]+)$/);
  if (method === "PATCH" && meetingTypeId) return { action: "scheduling.meeting_type.update", resourceType: "meeting_type", resourceId: meetingTypeId };
  if (method === "POST" && path === "/availability") return { action: "scheduling.availability.create", resourceType: "availability_rule" };
  const availabilityId = matchId(path, /^\/availability\/([^/]+)$/);
  if (method === "PATCH" && availabilityId) return { action: "scheduling.availability.update", resourceType: "availability_rule", resourceId: availabilityId };
  if (method === "DELETE" && availabilityId) return { action: "scheduling.availability.delete", resourceType: "availability_rule", resourceId: availabilityId };
  const retryBookingId = matchId(path, /^\/bookings\/([^/]+)\/calendar-sync\/retry$/);
  if (method === "POST" && retryBookingId) return { action: "scheduling.calendar_sync.retry", resourceType: "booking", resourceId: retryBookingId };
  if (method === "POST" && path === "/bookings") return { action: "scheduling.booking.create", resourceType: "booking" };
  const rescheduleBookingId = matchId(path, /^\/bookings\/([^/]+)\/reschedule$/);
  if (method === "POST" && rescheduleBookingId) return { action: "scheduling.booking.reschedule", resourceType: "booking", resourceId: rescheduleBookingId };
  const cancelBookingId = matchId(path, /^\/bookings\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelBookingId) return { action: "scheduling.booking.cancel", resourceType: "booking", resourceId: cancelBookingId };
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
