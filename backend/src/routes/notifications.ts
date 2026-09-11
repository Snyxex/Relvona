import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { NotificationService } from "../services/notificationService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent"]));

router.get("/", async (req: AuthRequest, res) => {
  try {
    const limit = Number(req.query.limit || 30);
    return res.json(await NotificationService.listForUser(req.organization!.id, req.user!.id, Number.isFinite(limit) ? limit : 30));
  } catch (error) {
    return sendInternalError(req, res, error, { code: "NOTIFICATIONS_LOAD_FAILED", message: "Unable to load notifications" });
  }
});

router.post("/:id/read", async (req: AuthRequest, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid notification ID" });
    const notification = await NotificationService.markRead(req.organization!.id, req.user!.id, req.params.id);
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    return res.json(notification);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "NOTIFICATION_READ_FAILED", message: "Unable to mark notification as read" });
  }
});

router.post("/read-all", async (req: AuthRequest, res) => {
  try {
    await NotificationService.markAllRead(req.organization!.id, req.user!.id);
    return res.status(204).end();
  } catch (error) {
    return sendInternalError(req, res, error, { code: "NOTIFICATIONS_READ_ALL_FAILED", message: "Unable to mark notifications as read" });
  }
});

router.get("/settings", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try { return res.json(await NotificationService.settings(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "NOTIFICATION_SETTINGS_LOAD_FAILED", message: "Unable to load notification settings" }); }
});

router.put("/settings", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try { return res.json(await NotificationService.updateSettings(req.organization!.id, req.body || {})); }
  catch (error) { return sendInternalError(req, res, error, { code: "NOTIFICATION_SETTINGS_UPDATE_FAILED", message: "Unable to update notification settings" }); }
});

export default router;
