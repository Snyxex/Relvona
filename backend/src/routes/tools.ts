import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { toolRegistry } from "../services/toolRegistry.js";
import { ActionExecutionService } from "../services/actionExecutionService.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

const catalogToolIds = [
  "support.get_ticket_case",
  "scheduling.find_available_slots",
  "scheduling.list_bookings",
  "scheduling.create_booking",
  "scheduling.reschedule_booking",
  "scheduling.cancel_booking",
];

router.get("/", (req: AuthRequest, res) => {
  const tools = toolRegistry.getAvailableTools({ actorRole: req.organization!.role }, catalogToolIds).map(({ execute: _execute, ...tool }) => tool);
  return res.json(tools);
});

router.get("/executions", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try { return res.json(await ActionExecutionService.list(req.organization!.id, typeof req.query.status === "string" ? req.query.status : undefined)); }
  catch { return res.status(500).json({ error: "Unable to load action executions" }); }
});

router.post("/executions", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    const { toolId, input, conversationId, customerId, idempotencyKey } = req.body || {};
    if (typeof toolId !== "string" || !input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ error: "Invalid action request" });
    const execution = await ActionExecutionService.request({
      context: { organizationId: req.organization!.id, conversationId: typeof conversationId === "string" ? conversationId : undefined, customerId: typeof customerId === "string" ? customerId : undefined, actorUserId: req.user!.id, actorRole: req.organization!.role },
      toolId,
      input,
      requestedByType: "user",
      requestedByUserId: req.user!.id,
      idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey.slice(0, 160) : undefined,
    });
    return res.status(201).json(execution);
  } catch (error) {
    const message = (error as Error).message;
    if (["Unknown tool", "Tool not permitted for viewer role"].includes(message)) return res.status(400).json({ error: message });
    return res.status(500).json({ error: "Unable to request action" });
  }
});

router.post("/executions/:id/approve", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    await ActionExecutionService.approve({ organizationId: req.organization!.id, executionId: req.params.id, userId: req.user!.id, reason: typeof req.body?.reason === "string" ? req.body.reason : undefined });
    const executed = await ActionExecutionService.execute({ organizationId: req.organization!.id, executionId: req.params.id, context: { organizationId: req.organization!.id, actorUserId: req.user!.id, actorRole: req.organization!.role } });
    return res.json(executed);
  } catch (error) { return res.status(409).json({ error: (error as Error).message }); }
});

router.post("/executions/:id/reject", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try { return res.json(await ActionExecutionService.reject({ organizationId: req.organization!.id, executionId: req.params.id, userId: req.user!.id, reason: typeof req.body?.reason === "string" ? req.body.reason : undefined })); }
  catch (error) { return res.status(409).json({ error: (error as Error).message }); }
});

router.post("/executions/:id/execute", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try { return res.json(await ActionExecutionService.execute({ organizationId: req.organization!.id, executionId: req.params.id, context: { organizationId: req.organization!.id, actorUserId: req.user!.id, actorRole: req.organization!.role } })); }
  catch (error) { return res.status(409).json({ error: (error as Error).message }); }
});

export default router;
