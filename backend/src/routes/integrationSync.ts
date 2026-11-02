import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLogs, users } from "../db/schema.js";
import { integrationSyncExecutions } from "../db/integrationSyncSchema.js";
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

router.get("/executions/:id/audit", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.organization!.id;
    const [execution] = await db.select({ id: integrationSyncExecutions.id })
      .from(integrationSyncExecutions)
      .where(and(eq(integrationSyncExecutions.organizationId, organizationId), eq(integrationSyncExecutions.id, req.params.id)))
      .limit(1);
    if (!execution) return res.status(404).json({ error: "Integration sync execution not found" });
    const entries = await db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorUserId: auditLogs.actorUserId,
      actorName: users.name,
    }).from(auditLogs).leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(and(
        eq(auditLogs.organizationId, organizationId),
        eq(auditLogs.resourceType, "integration_sync_execution"),
        eq(auditLogs.resourceId, execution.id),
      ))
      .orderBy(desc(auditLogs.createdAt)).limit(50);
    res.setHeader("Cache-Control", "no-store");
    return res.json(entries);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "SYNC_AUDIT_LOAD_FAILED", message: "Unable to load reconciliation history" });
  }
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

router.post("/executions/:id/confirm-remote", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  const externalTicketId = req.body?.externalTicketId;
  if (typeof externalTicketId !== "string" || !/^[0-9]{1,20}$/.test(externalTicketId)) {
    return res.status(400).json({ error: "Invalid Zendesk ticket id" });
  }
  try {
    return res.json(await IntegrationSyncService.confirmRemoteExecution({
      organizationId: req.organization!.id,
      executionId: req.params.id,
      externalTicketId,
      actorUserId: req.user!.id,
    }));
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Integration sync execution not found" || message === "Integration sync rule not found") return res.status(404).json({ error: message });
    if (message === "Execution does not require reconciliation" || message === "Execution reconciliation conflict") return res.status(409).json({ error: message });
    return sendInternalError(req, res, error, { code: "SYNC_RECONCILIATION_FAILED", message: "Zendesk record could not be verified" });
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
