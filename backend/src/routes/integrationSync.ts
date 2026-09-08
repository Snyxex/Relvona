import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { IntegrationSyncService } from "../services/integrationSyncService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

router.get("/rules", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try { return res.json(await IntegrationSyncService.listRules(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "INTEGRATION_SYNC_RULES_LOAD_FAILED", message: "Unable to load integration sync rules" }); }
});

router.get("/executions", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try { return res.json(await IntegrationSyncService.listExecutions(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "INTEGRATION_SYNC_EXECUTIONS_LOAD_FAILED", message: "Unable to load integration sync executions" }); }
});

router.post("/executions/:id/retry", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try { return res.json(await IntegrationSyncService.retryExecution(req.organization!.id, req.params.id)); }
  catch (error) {
    const message = (error as Error).message;
    if (["Integration sync execution not found", "Integration sync rule not found"].includes(message)) return res.status(404).json({ error: message });
    if (/Only failed|disabled|no longer retryable/i.test(message)) return res.status(409).json({ error: message });
    return sendInternalError(req, res, error, { code: "INTEGRATION_SYNC_RETRY_FAILED", message: "Unable to retry integration sync execution" });
  }
});

router.post("/rules", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { connectionId, eventType, action } = req.body || {};
    if (typeof connectionId !== "string" || typeof eventType !== "string" || typeof action !== "string") return res.status(400).json({ error: "Invalid sync rule" });
    const rule = await IntegrationSyncService.createRule({ organizationId: req.organization!.id, connectionId, eventType, action, enabled: false });
    return res.status(201).json(rule);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Integration connection not found") return res.status(404).json({ error: message });
    if (/Unsupported|requires|already exists/i.test(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "INTEGRATION_SYNC_RULE_CREATE_FAILED", message: "Unable to create integration sync rule" });
  }
});

router.patch("/rules/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled must be boolean" });
    return res.json(await IntegrationSyncService.setEnabled(req.organization!.id, req.params.id, req.body.enabled));
  } catch (error) {
    if ((error as Error).message === "Integration sync rule not found") return res.status(404).json({ error: "Integration sync rule not found" });
    return sendInternalError(req, res, error, { code: "INTEGRATION_SYNC_RULE_UPDATE_FAILED", message: "Unable to update integration sync rule" });
  }
});

router.delete("/rules/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try { await IntegrationSyncService.removeRule(req.organization!.id, req.params.id); return res.status(204).end(); }
  catch (error) {
    if ((error as Error).message === "Integration sync rule not found") return res.status(404).json({ error: "Integration sync rule not found" });
    return sendInternalError(req, res, error, { code: "INTEGRATION_SYNC_RULE_DELETE_FAILED", message: "Unable to delete integration sync rule" });
  }
});

export default router;
