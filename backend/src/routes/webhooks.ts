import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { webhookDeliveries, webhookEvents } from "../db/webhookSchema.js";
import { WEBHOOK_EVENT_TYPES, WebhookService } from "../services/webhookService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin"]));

router.get("/event-types", (_req, res) => res.json(WEBHOOK_EVENT_TYPES));

router.get("/", async (req: AuthRequest, res) => {
  try { return res.json(await WebhookService.list(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "WEBHOOK_LIST_FAILED", message: "Unable to load webhook subscriptions" }); }
});

router.post("/", async (req: AuthRequest, res) => {
  try {
    const { name, url, eventTypes } = req.body || {};
    if (typeof name !== "string" || typeof url !== "string") return res.status(400).json({ error: "Webhook name and URL are required" });
    const created = await WebhookService.create({ organizationId: req.organization!.id, name, url, eventTypes });
    return res.status(201).json(created);
  } catch (error) {
    const message = (error as Error).message;
    if (/Webhook|eventTypes|Private\/internal|Invalid webhook/i.test(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "WEBHOOK_CREATE_FAILED", message: "Unable to create webhook subscription" });
  }
});

router.patch("/:id", async (req: AuthRequest, res) => {
  try {
    return res.json(await WebhookService.update({
      organizationId: req.organization!.id,
      id: req.params.id,
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      url: typeof req.body?.url === "string" ? req.body.url : undefined,
      eventTypes: req.body?.eventTypes,
      enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined,
    }));
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Webhook subscription not found") return res.status(404).json({ error: message });
    if (/Webhook|eventTypes|Private\/internal|Invalid webhook/i.test(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "WEBHOOK_UPDATE_FAILED", message: "Unable to update webhook subscription" });
  }
});

router.post("/:id/rotate-secret", async (req: AuthRequest, res) => {
  try { return res.json(await WebhookService.rotateSecret(req.organization!.id, req.params.id)); }
  catch (error) { return (error as Error).message === "Webhook subscription not found" ? res.status(404).json({ error: "Webhook subscription not found" }) : sendInternalError(req, res, error, { code: "WEBHOOK_SECRET_ROTATION_FAILED", message: "Unable to rotate webhook secret" }); }
});

router.delete("/:id", async (req: AuthRequest, res) => {
  try { await WebhookService.remove(req.organization!.id, req.params.id); return res.status(204).end(); }
  catch (error) { return (error as Error).message === "Webhook subscription not found" ? res.status(404).json({ error: "Webhook subscription not found" }) : sendInternalError(req, res, error, { code: "WEBHOOK_DELETE_FAILED", message: "Unable to delete webhook subscription" }); }
});

router.get("/:id/deliveries", async (req: AuthRequest, res) => {
  try {
    const rows = await db.select({ delivery: webhookDeliveries, eventType: webhookEvents.type, occurredAt: webhookEvents.occurredAt })
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
      .where(and(eq(webhookDeliveries.organizationId, req.organization!.id), eq(webhookDeliveries.subscriptionId, req.params.id)))
      .orderBy(desc(webhookDeliveries.createdAt)).limit(100);
    return res.json(rows);
  } catch (error) { return sendInternalError(req, res, error, { code: "WEBHOOK_DELIVERIES_FAILED", message: "Unable to load webhook deliveries" }); }
});

export default router;
