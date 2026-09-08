import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { IntegrationConnectionService } from "../services/integrationConnectionService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin"]));

router.get("/", async (req: AuthRequest, res) => {
  try { return res.json(await IntegrationConnectionService.list(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "INTEGRATIONS_LIST_FAILED", message: "Unable to load integrations" }); }
});

router.post("/", async (req: AuthRequest, res) => {
  try {
    const { provider, name, config, credentials } = req.body || {};
    if (!["hubspot", "zendesk"].includes(provider) || typeof name !== "string" || !config || typeof config !== "object" || Array.isArray(config) || !credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      return res.status(400).json({ error: "Invalid integration configuration" });
    }
    const created = await IntegrationConnectionService.create({ organizationId: req.organization!.id, provider, name, config, credentials });
    return res.status(201).json(created);
  } catch (error) {
    const message = (error as Error).message;
    if (/Invalid|Unsupported|encrypt/i.test(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "INTEGRATION_CREATE_FAILED", message: "Unable to create integration" });
  }
});

router.get("/:id/zendesk-webhook-setup", async (req: AuthRequest, res) => {
  try {
    const organizationId = req.organization!.id;
    const connections = await IntegrationConnectionService.list(organizationId);
    const connection = connections.find((item) => item.id === req.params.id && item.provider === "zendesk");
    if (!connection) return res.status(404).json({ error: "Zendesk integration connection not found" });
    let signingSecretConfigured = false;
    try {
      await IntegrationConnectionService.getZendeskWebhookSigningSecret(organizationId, connection.id);
      signingSecretConfigured = true;
    } catch (error) {
      const message = (error as Error).message;
      if (!["Zendesk webhook signing secret is not configured", "zendesk integration is not configured"].includes(message)) throw error;
    }
    return res.json({
      connectionId: connection.id,
      enabled: connection.enabled,
      signingSecretConfigured,
      callbackPath: `/api/v1/integrations/zendesk/inbound/${organizationId}/${connection.id}`,
      payloadTemplate: { eventType: "ticket.updated", ticket: { id: "{{ticket.id}}", status: "{{ticket.status}}", priority: "{{ticket.priority}}" } },
    });
  } catch (error) {
    return sendInternalError(req, res, error, { code: "ZENDESK_WEBHOOK_SETUP_LOAD_FAILED", message: "Unable to load Zendesk webhook setup" });
  }
});

router.patch("/:id", async (req: AuthRequest, res) => {
  try {
    const { name, enabled, config, credentials } = req.body || {};
    const updated = await IntegrationConnectionService.update({ organizationId: req.organization!.id, id: req.params.id, name, enabled, config, credentials });
    return res.json(updated);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Integration connection not found") return res.status(404).json({ error: message });
    if (/Invalid/i.test(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "INTEGRATION_UPDATE_FAILED", message: "Unable to update integration" });
  }
});

router.post("/:id/zendesk-webhook-secret", async (req: AuthRequest, res) => {
  try {
    const secret = req.body?.secret;
    if (typeof secret !== "string") return res.status(400).json({ error: "secret is required" });
    await IntegrationConnectionService.setZendeskWebhookSigningSecret(req.organization!.id, req.params.id, secret);
    return res.status(204).end();
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Zendesk integration connection not found") return res.status(404).json({ error: message });
    if (/Invalid/i.test(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "ZENDESK_WEBHOOK_SECRET_UPDATE_FAILED", message: "Unable to update Zendesk webhook signing secret" });
  }
});

router.post("/:id/test", async (req: AuthRequest, res) => {
  try { return res.json(await IntegrationConnectionService.test(req.organization!.id, req.params.id)); }
  catch (error) {
    const message = (error as Error).message;
    if (message === "Integration connection not found") return res.status(404).json({ error: message });
    return res.status(400).json({ error: message });
  }
});

router.delete("/:id", async (req: AuthRequest, res) => {
  try { await IntegrationConnectionService.remove(req.organization!.id, req.params.id); return res.status(204).end(); }
  catch (error) { return (error as Error).message === "Integration connection not found" ? res.status(404).json({ error: "Integration connection not found" }) : sendInternalError(req, res, error, { code: "INTEGRATION_DELETE_FAILED", message: "Unable to delete integration" }); }
});

export default router;
