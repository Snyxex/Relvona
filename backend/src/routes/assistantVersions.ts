import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { AssistantVersionService } from "../services/assistantVersionService.js";
import { AssistantPlaygroundService } from "../services/assistantPlaygroundService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

router.get("/:assistantId/versions", requireRole(["owner", "admin", "agent", "viewer"]), async (req: AuthRequest, res) => {
  try { return res.json(await AssistantVersionService.list(req.organization!.id, req.params.assistantId)); }
  catch (error) { return sendInternalError(req, res, error, { code: "ASSISTANT_VERSIONS_LOAD_FAILED", message: "Unable to load assistant versions" }); }
});

router.post("/:assistantId/versions", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const label = req.body?.label;
    if (label !== undefined && (typeof label !== "string" || label.length > 120)) return res.status(400).json({ error: "Invalid version label" });
    const version = await AssistantVersionService.publish({
      organizationId: req.organization!.id,
      assistantId: req.params.assistantId,
      userId: req.user!.id,
      label,
    });
    return res.status(201).json(version);
  } catch (error) {
    if ((error as Error).message === "Assistant not found") return res.status(404).json({ error: "Assistant not found" });
    return sendInternalError(req, res, error, { code: "ASSISTANT_VERSION_PUBLISH_FAILED", message: "Unable to publish assistant version" });
  }
});

router.post("/:assistantId/versions/:versionId/activate", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const result = await AssistantVersionService.activate({
      organizationId: req.organization!.id,
      assistantId: req.params.assistantId,
      versionId: req.params.versionId,
    });
    return res.json({ version: result.version, assistantId: result.assistant.id });
  } catch (error) {
    const message = (error as Error).message;
    if (["Assistant not found", "Assistant version not found"].includes(message)) return res.status(404).json({ error: message });
    return sendInternalError(req, res, error, { code: "ASSISTANT_VERSION_ACTIVATE_FAILED", message: "Unable to activate assistant version" });
  }
});

router.post("/:assistantId/versions/:versionId/playground", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    const { message, history } = req.body || {};
    if (typeof message !== "string" || !message.trim() || message.length > 6_000) return res.status(400).json({ error: "Playground message must be between 1 and 6,000 characters" });
    if (history !== undefined && (!Array.isArray(history) || history.length > 12 || history.some((entry) => !entry || !["user", "assistant"].includes(entry.role) || typeof entry.content !== "string" || entry.content.length > 4_000))) {
      return res.status(400).json({ error: "Invalid playground history" });
    }
    return res.json(await AssistantPlaygroundService.run({
      organizationId: req.organization!.id,
      assistantId: req.params.assistantId,
      versionId: req.params.versionId,
      message,
      history,
    }));
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Assistant version not found") return res.status(404).json({ error: message });
    if (message === "A non-empty playground message is required") return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { status: 503, code: "ASSISTANT_PLAYGROUND_FAILED", message: "Playground evaluation is currently unavailable" });
  }
});

export default router;
