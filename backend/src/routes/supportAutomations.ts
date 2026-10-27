import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { SupportAutomationService } from "../services/supportAutomationService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.use(authenticate, tenantContext, requireRole(["owner", "admin"]));

router.get("/", async (req: AuthRequest, res) => {
  try { return res.json(await SupportAutomationService.list(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "AUTOMATION_RULES_LOAD_FAILED", message: "Unable to load automation rules" }); }
});

router.get("/runs", async (req: AuthRequest, res) => {
  try {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ error: "Invalid history limit" });
    return res.json(await SupportAutomationService.history(req.organization!.id, limit));
  } catch (error) { return sendInternalError(req, res, error, { code: "AUTOMATION_HISTORY_FAILED", message: "Unable to load automation history" }); }
});

router.post("/simulate", async (req: AuthRequest, res) => {
  try {
    if (!UUID.test(req.body?.ticketId || "")) return res.status(400).json({ error: "Invalid ticket ID" });
    return res.json(await SupportAutomationService.preview(req.organization!.id, req.body.ticketId, req.body.rule));
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Ticket not found") return res.status(404).json({ error: message });
    if (message.startsWith("Invalid") || message.startsWith("Unknown") || message.startsWith("Duplicate")) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "AUTOMATION_SIMULATE_FAILED", message: "Unable to simulate automation" });
  }
});

router.post("/", async (req: AuthRequest, res) => {
  try { return res.status(201).json(await SupportAutomationService.save(req.organization!.id, req.user!.id, req.body)); }
  catch (error) {
    const message = (error as Error).message;
    if (/^(Invalid|Unknown|Duplicate|Rule limit)/.test(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "AUTOMATION_SAVE_FAILED", message: "Unable to save automation rule" });
  }
});

router.put("/:id", async (req: AuthRequest, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Invalid rule ID" });
    return res.json(await SupportAutomationService.save(req.organization!.id, req.user!.id, req.body, req.params.id));
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Rule not found") return res.status(404).json({ error: message });
    if (/^(Invalid|Unknown|Duplicate|Rule limit)/.test(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "AUTOMATION_UPDATE_FAILED", message: "Unable to update automation rule" });
  }
});

router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Invalid rule ID" });
    return await SupportAutomationService.remove(req.organization!.id, req.params.id) ? res.status(204).end()
      : res.status(404).json({ error: "Rule not found" });
  } catch (error) { return sendInternalError(req, res, error, { code: "AUTOMATION_DELETE_FAILED", message: "Unable to delete automation rule" }); }
});

export default router;
