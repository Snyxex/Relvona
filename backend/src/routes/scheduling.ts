import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { SchedulingService } from "../services/schedulingService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent"]));

router.get("/meeting-types", async (req: AuthRequest, res) => {
  try { return res.json(await SchedulingService.listMeetingTypes(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "MEETING_TYPES_LOAD_FAILED", message: "Unable to load meeting types" }); }
});

router.post("/meeting-types", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const row = await SchedulingService.createMeetingType({ organizationId: req.organization!.id, ...req.body });
    return res.status(201).json(row);
  } catch (error) {
    if ((error as Error).message === "Invalid meeting type") return res.status(400).json({ error: "Invalid meeting type" });
    return sendInternalError(req, res, error, { code: "MEETING_TYPE_CREATE_FAILED", message: "Unable to create meeting type" });
  }
});

router.get("/availability", async (req: AuthRequest, res) => {
  try { return res.json(await SchedulingService.listAvailabilityRules(req.organization!.id, typeof req.query.meetingTypeId === "string" ? req.query.meetingTypeId : undefined)); }
  catch (error) { return sendInternalError(req, res, error, { code: "AVAILABILITY_LOAD_FAILED", message: "Unable to load availability" }); }
});

router.post("/availability", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const rule = await SchedulingService.addAvailabilityRule({ organizationId: req.organization!.id, ...req.body });
    return res.status(201).json(rule);
  } catch (error) {
    const message = (error as Error).message;
    if (["Invalid availability rule", "User not found", "Meeting type not found"].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "AVAILABILITY_CREATE_FAILED", message: "Unable to create availability" });
  }
});

router.get("/bookings", async (req: AuthRequest, res) => {
  try { return res.json(await SchedulingService.listBookings(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "BOOKINGS_LOAD_FAILED", message: "Unable to load bookings" }); }
});

router.post("/bookings", async (req: AuthRequest, res) => {
  try {
    const startsAt = new Date(req.body?.startsAt);
    const booking = await SchedulingService.createBooking({ organizationId: req.organization!.id, ...req.body, startsAt, createdBy: "agent" });
    return res.status(201).json(booking);
  } catch (error) {
    const message = (error as Error).message;
    if (["Invalid booking time", "Meeting type not found", "Booking violates minimum notice", "Booking exceeds allowed future range", "Booking conflict", "Customer not found"].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "BOOKING_CREATE_FAILED", message: "Unable to create booking" });
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
