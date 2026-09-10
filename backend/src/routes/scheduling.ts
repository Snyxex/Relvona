import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { SchedulingService } from "../services/schedulingService.js";
import { SchedulingAuthorizationService } from "../services/schedulingAuthorizationService.js";
import { BookingCalendarSyncService } from "../services/bookingCalendarSyncService.js";
import { MeetingTypeAdminService } from "../services/meetingTypeAdminService.js";
import { sendInternalError } from "../utils/httpErrors.js";
import { db } from "../db/index.js";
import { bookingCalendarSync } from "../db/bookingCalendarSyncSchema.js";
import { calendarConnections, bookings } from "../db/extendedCustomerExperienceSchema.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent"]));

const schedulableMemberError = "Assigned user is not a schedulable organization member";

router.get("/connections", async (req: AuthRequest, res) => {
  try {
    const conditions = [eq(calendarConnections.organizationId, req.organization!.id)];
    if (req.organization!.role === "agent") conditions.push(eq(calendarConnections.userId, req.user!.id));
    const rows = await db.select({ id: calendarConnections.id, userId: calendarConnections.userId, provider: calendarConnections.provider, externalAccountId: calendarConnections.externalAccountId, status: calendarConnections.status, createdAt: calendarConnections.createdAt, updatedAt: calendarConnections.updatedAt }).from(calendarConnections).where(and(...conditions));
    return res.json(rows);
  } catch (error) { return sendInternalError(req, res, error, { code: "CALENDAR_CONNECTIONS_LOAD_FAILED", message: "Unable to load calendar connections" }); }
});

router.delete("/connections/:id", async (req: AuthRequest, res) => {
  try {
    const conditions = [eq(calendarConnections.organizationId, req.organization!.id), eq(calendarConnections.id, req.params.id)];
    if (req.organization!.role === "agent") conditions.push(eq(calendarConnections.userId, req.user!.id));
    const [connection] = await db.update(calendarConnections).set({ status: "revoked", encryptedCredentials: null, updatedAt: new Date() }).where(and(...conditions)).returning({ id: calendarConnections.id });
    if (!connection) return res.status(404).json({ error: "Calendar connection not found" });
    return res.status(204).end();
  } catch (error) { return sendInternalError(req, res, error, { code: "CALENDAR_CONNECTION_DELETE_FAILED", message: "Unable to disconnect calendar" }); }
});

router.get("/meeting-types", async (req: AuthRequest, res) => {
  try { return res.json(await SchedulingService.listMeetingTypes(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "MEETING_TYPES_LOAD_FAILED", message: "Unable to load meeting types" }); }
});

router.post("/meeting-types", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try { return res.status(201).json(await SchedulingService.createMeetingType({ organizationId: req.organization!.id, ...req.body })); }
  catch (error) {
    if ((error as Error).message === "Invalid meeting type") return res.status(400).json({ error: "Invalid meeting type" });
    return sendInternalError(req, res, error, { code: "MEETING_TYPE_CREATE_FAILED", message: "Unable to create meeting type" });
  }
});

router.patch("/meeting-types/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try { return res.json(await MeetingTypeAdminService.update(req.organization!.id, req.params.id, req.body || {})); }
  catch (error) {
    const message = (error as Error).message;
    if (message === "Meeting type not found") return res.status(404).json({ error: message });
    if (message === "Invalid meeting type") return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "MEETING_TYPE_UPDATE_FAILED", message: "Unable to update meeting type" });
  }
});

router.get("/availability", async (req: AuthRequest, res) => {
  try { return res.json(await SchedulingService.listAvailabilityRules(req.organization!.id, typeof req.query.meetingTypeId === "string" ? req.query.meetingTypeId : undefined)); }
  catch (error) { return sendInternalError(req, res, error, { code: "AVAILABILITY_LOAD_FAILED", message: "Unable to load availability" }); }
});

router.post("/availability", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const userId = typeof req.body?.userId === "string" ? req.body.userId : undefined;
    await SchedulingAuthorizationService.assertSchedulableMember(req.organization!.id, userId);
    return res.status(201).json(await SchedulingService.addAvailabilityRule({ organizationId: req.organization!.id, ...req.body, userId }));
  } catch (error) {
    const message = (error as Error).message;
    if (["Invalid availability rule", "User not found", "Meeting type not found", schedulableMemberError].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "AVAILABILITY_CREATE_FAILED", message: "Unable to create availability" });
  }
});

router.get("/slots", async (req: AuthRequest, res) => {
  try {
    const meetingTypeId = String(req.query.meetingTypeId || "");
    const assignedUserId = typeof req.query.assignedUserId === "string" ? req.query.assignedUserId : undefined;
    await SchedulingAuthorizationService.assertSchedulableMember(req.organization!.id, assignedUserId);
    const from = new Date(String(req.query.from || ""));
    const to = new Date(String(req.query.to || ""));
    const slots = await SchedulingService.findAvailableSlots({ organizationId: req.organization!.id, meetingTypeId, assignedUserId, from, to, limit: req.query.limit ? Number(req.query.limit) : undefined });
    return res.json(slots);
  } catch (error) {
    const message = (error as Error).message;
    if (["Invalid slot range", "Meeting type not found", schedulableMemberError].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "SLOTS_LOAD_FAILED", message: "Unable to calculate available slots" });
  }
});

router.get("/bookings", async (req: AuthRequest, res) => {
  try { return res.json(await SchedulingService.listBookings(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "BOOKINGS_LOAD_FAILED", message: "Unable to load bookings" }); }
});

router.get("/bookings/:id/calendar-sync", async (req: AuthRequest, res) => {
  try {
    const organizationId = req.organization!.id;
    const [booking] = await db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, req.params.id))).limit(1);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    const [sync] = await db.select().from(bookingCalendarSync).where(and(eq(bookingCalendarSync.organizationId, organizationId), eq(bookingCalendarSync.bookingId, booking.id))).limit(1);
    return res.json(sync || { bookingId: booking.id, status: "not_required", action: null, attempts: 0, lastError: null, nextAttemptAt: null });
  } catch (error) {
    return sendInternalError(req, res, error, { code: "BOOKING_CALENDAR_SYNC_LOAD_FAILED", message: "Unable to load calendar sync status" });
  }
});

router.post("/bookings/:id/calendar-sync/retry", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.organization!.id;
    const [booking] = await db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, req.params.id))).limit(1);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    const retried = await BookingCalendarSyncService.retry(organizationId, booking.id);
    if (!retried) return res.status(409).json({ error: "Calendar sync is not retryable" });
    const result = await BookingCalendarSyncService.processOne(organizationId, booking.id);
    const [sync] = await db.select().from(bookingCalendarSync).where(and(eq(bookingCalendarSync.organizationId, organizationId), eq(bookingCalendarSync.bookingId, booking.id))).limit(1);
    return res.json({ sync, result });
  } catch (error) {
    return sendInternalError(req, res, error, { code: "BOOKING_CALENDAR_SYNC_RETRY_FAILED", message: "Unable to retry calendar sync" });
  }
});

router.post("/bookings", async (req: AuthRequest, res) => {
  try {
    const assignedUserId = typeof req.body?.assignedUserId === "string" ? req.body.assignedUserId : undefined;
    await SchedulingAuthorizationService.assertSchedulableMember(req.organization!.id, assignedUserId);
    const booking = await SchedulingService.createBooking({ organizationId: req.organization!.id, ...req.body, assignedUserId, startsAt: new Date(req.body?.startsAt), createdBy: "agent" });
    return res.status(201).json(booking);
  } catch (error) {
    const message = (error as Error).message;
    if (["Invalid booking time", "Meeting type not found", "Booking violates minimum notice", "Booking exceeds allowed future range", "Booking conflict", "External calendar conflict", "Customer not found", schedulableMemberError].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "BOOKING_CREATE_FAILED", message: "Unable to create booking" });
  }
});

router.post("/bookings/:id/reschedule", async (req: AuthRequest, res) => {
  try {
    const booking = await SchedulingService.rescheduleBooking({ organizationId: req.organization!.id, bookingId: req.params.id, startsAt: new Date(req.body?.startsAt), timezone: req.body?.timezone, actorType: "agent", actorUserId: req.user!.id });
    return res.json(booking);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Booking not found") return res.status(404).json({ error: message });
    if (["Invalid booking time", "Meeting type not found", "Booking violates minimum notice", "Booking exceeds allowed future range", "Booking conflict", "External calendar conflict"].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "BOOKING_RESCHEDULE_FAILED", message: "Unable to reschedule booking" });
  }
});

router.post("/bookings/:id/cancel", async (req: AuthRequest, res) => {
  try { return res.json(await SchedulingService.cancelBooking({ organizationId: req.organization!.id, bookingId: req.params.id, actorType: "agent", actorUserId: req.user!.id })); }
  catch (error) {
    if ((error as Error).message === "Booking not found") return res.status(404).json({ error: "Booking not found" });
    return sendInternalError(req, res, error, { code: "BOOKING_CANCEL_FAILED", message: "Unable to cancel booking" });
  }
});

export default router;
