import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { AnalyticsService } from "../services/analyticsService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

router.get("/overview", async (req: AuthRequest, res) => {
  try {
    const overview = await AnalyticsService.getOverviewMetrics(req.organization!.id);
    return res.json(overview);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "ANALYTICS_OVERVIEW_FAILED", message: "Unable to load analytics overview" });
  }
});

router.get("/support", requireRole(["owner", "admin", "agent", "viewer"]), async (req: AuthRequest, res) => {
  try {
    const days = typeof req.query.days === "string" ? Number(req.query.days) : 30;
    return res.json(await AnalyticsService.getSupportMetrics(req.organization!.id, days));
  } catch (error) {
    return sendInternalError(req, res, error, { code: "SUPPORT_ANALYTICS_FAILED", message: "Unable to load support analytics" });
  }
});

router.get("/knowledge-gaps", requireRole(["owner", "admin", "agent", "viewer"]), async (req: AuthRequest, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    return res.json(await AnalyticsService.listKnowledgeGaps(req.organization!.id, status, limit));
  } catch (error) {
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_GAPS_LOAD_FAILED", message: "Unable to load knowledge gaps" });
  }
});

router.post("/knowledge-gaps", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    const { topic, summary, sourceConversationId, metadata } = req.body || {};
    if (typeof topic !== "string" || typeof summary !== "string") return res.status(400).json({ error: "Knowledge gap requires a topic and summary" });
    const gap = await AnalyticsService.recordKnowledgeGap({
      organizationId: req.organization!.id,
      topic,
      summary,
      sourceConversationId: typeof sourceConversationId === "string" ? sourceConversationId : undefined,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : undefined,
    });
    return res.status(201).json(gap);
  } catch (error) {
    const message = (error as Error).message;
    if (["Knowledge gap requires a topic and summary", "Conversation not found"].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_GAP_CREATE_FAILED", message: "Unable to create knowledge gap" });
  }
});

router.patch("/knowledge-gaps/:id", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    if (typeof req.body?.status !== "string") return res.status(400).json({ error: "Invalid knowledge gap status" });
    return res.json(await AnalyticsService.updateKnowledgeGapStatus(req.organization!.id, req.params.id, req.body.status));
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Knowledge gap not found") return res.status(404).json({ error: message });
    if (message === "Invalid knowledge gap status") return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_GAP_UPDATE_FAILED", message: "Unable to update knowledge gap" });
  }
});

export default router;
