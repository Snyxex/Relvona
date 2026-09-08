import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { AssistantVersionService } from "../services/assistantVersionService.js";
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

export default router;
