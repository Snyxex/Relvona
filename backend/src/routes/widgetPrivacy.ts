import { Router } from "express";
import { pool } from "../db/index.js";
import { setDatabaseTenant } from "../db/tenantContext.js";
import { createRateLimiter } from "../middleware/security.js";
import { VisitorIdentityService } from "../services/visitorIdentityService.js";

const router = Router();
type PublicAssistant = { id: string; organization_id: string; widget_allowed_origins: unknown };

async function publicWidgetAssistant(id: string, widgetKey: string) {
  return (await pool.query("SELECT * FROM supportai_public_widget_assistant($1, $2)", [id, widgetKey])).rows[0] as PublicAssistant | undefined;
}

function allowsRequestOrigin(req: { get(name: string): string | undefined }, assistant: PublicAssistant) {
  const origin = req.get("origin");
  const allowed = Array.isArray(assistant.widget_allowed_origins) ? assistant.widget_allowed_origins.filter((value): value is string => typeof value === "string") : [];
  const hostedPageOrigin = `${req.get("x-forwarded-proto") || "http"}://${req.get("host")}`;
  if (origin) return allowed.includes(origin) || origin === hostedPageOrigin;
  const referer = req.get("referer");
  try {
    const url = referer ? new URL(referer) : undefined;
    return Boolean(url && url.origin === hostedPageOrigin && url.pathname.startsWith("/api/v1/widget/page/"));
  } catch { return false; }
}

async function authenticateWidget(req: any) {
  const assistantId = req.body?.assistantId ?? req.query?.assistantId;
  const widgetKey = req.body?.widgetKey ?? req.query?.widgetKey;
  if (typeof assistantId !== "string" || typeof widgetKey !== "string") return undefined;
  const assistant = await publicWidgetAssistant(assistantId, widgetKey);
  if (!assistant || !allowsRequestOrigin(req, assistant)) return undefined;
  setDatabaseTenant(assistant.organization_id);
  return assistant;
}

router.get("/state", createRateLimiter({ keyPrefix: "widget-privacy-state", limit: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const assistant = await authenticateWidget(req);
    if (!assistant) return res.status(401).json({ error: "Invalid widget integration or origin" });
    return res.json(await VisitorIdentityService.privacyStateByToken(assistant.organization_id, req.query.visitorToken));
  } catch { return res.status(500).json({ error: "Unable to load privacy state" }); }
});

router.post("/memory", createRateLimiter({ keyPrefix: "widget-privacy-memory", limit: 12, windowMs: 60_000 }), async (req, res) => {
  try {
    const assistant = await authenticateWidget(req);
    if (!assistant || typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "Invalid privacy request" });
    const result = await VisitorIdentityService.setMemoryEnabledByToken({
      organizationId: assistant.organization_id,
      visitorToken: req.body?.visitorToken,
      enabled: req.body.enabled,
      consentVersion: typeof req.body?.consentVersion === "string" ? req.body.consentVersion : "v1",
    });
    return res.json(result);
  } catch { return res.status(400).json({ error: "Unable to update memory preference" }); }
});

router.delete("/visitor", createRateLimiter({ keyPrefix: "widget-privacy-delete", limit: 6, windowMs: 15 * 60_000 }), async (req, res) => {
  try {
    const assistant = await authenticateWidget(req);
    if (!assistant) return res.status(401).json({ error: "Invalid widget integration or origin" });
    await VisitorIdentityService.eraseVisitorByToken(assistant.organization_id, req.body?.visitorToken);
    return res.status(204).end();
  } catch { return res.status(400).json({ error: "Unable to erase visitor data" }); }
});

export default router;