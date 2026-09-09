import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { knowledgeGaps } from "../db/supportAnalyticsSchema.js";
import { KnowledgeIntelligenceService } from "../services/knowledgeIntelligenceService.js";
import { AuditService } from "../services/auditService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent", "viewer"]));

router.get("/health", async (req: AuthRequest, res) => {
  try {
    const knowledgeBaseId = typeof req.query.knowledgeBaseId === "string" ? req.query.knowledgeBaseId : undefined;
    return res.json(await KnowledgeIntelligenceService.getHealthOverview(req.organization!.id, knowledgeBaseId));
  } catch (error) {
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_HEALTH_FAILED", message: "Unable to calculate knowledge health" });
  }
});

router.get("/sources", async (req: AuthRequest, res) => {
  try {
    return res.json(await KnowledgeIntelligenceService.listSources(req.organization!.id, req.query as Record<string, unknown>));
  } catch (error) {
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_INTELLIGENCE_SOURCES_FAILED", message: "Unable to load knowledge source intelligence" });
  }
});

router.patch("/sources/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const updated = await KnowledgeIntelligenceService.updateSourceSettings(req.organization!.id, req.params.id, req.body || {});
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.source_intelligence_updated", resourceType: "knowledge_source", resourceId: req.params.id });
    return res.json(updated);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Knowledge source not found") return res.status(404).json({ error: message });
    if (message.startsWith("Invalid ")) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_SOURCE_SETTINGS_FAILED", message: "Unable to update knowledge source settings" });
  }
});

router.post("/sources/:id/recompute-health", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    return res.json(await KnowledgeIntelligenceService.recomputeSourceHealth(req.organization!.id, req.params.id));
  } catch (error) {
    if ((error as Error).message === "Knowledge source not found") return res.status(404).json({ error: "Knowledge source not found" });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_SOURCE_HEALTH_FAILED", message: "Unable to recompute source health" });
  }
});

router.get("/sources/:id/retrievals", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    return res.json(await KnowledgeIntelligenceService.listRetrievalEvents(req.organization!.id, req.params.id, req.query.limit));
  } catch (error) {
    if ((error as Error).message === "Knowledge source not found") return res.status(404).json({ error: "Knowledge source not found" });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_RETRIEVAL_DEBUG_FAILED", message: "Unable to load retrieval history" });
  }
});

router.get("/gaps", async (req: AuthRequest, res) => {
  try {
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
    const rows = await db.select().from(knowledgeGaps).where(and(
      eq(knowledgeGaps.organizationId, req.organization!.id),
      status ? eq(knowledgeGaps.status, status) : undefined,
    )).orderBy(desc(knowledgeGaps.impactScore), desc(knowledgeGaps.occurrences), desc(knowledgeGaps.lastSeenAt)).limit(limit);
    return res.json(rows);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_GAPS_LOAD_FAILED", message: "Unable to load knowledge gaps" });
  }
});

router.patch("/gaps/:id", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    const status = typeof req.body?.status === "string" ? req.body.status.toUpperCase() : "";
    if (!["OPEN", "REVIEWING", "CONTENT_DRAFTED", "RESOLVED", "IGNORED"].includes(status)) return res.status(400).json({ error: "Invalid knowledge gap status" });
    const [updated] = await db.update(knowledgeGaps).set({ status, resolvedAt: status === "RESOLVED" ? new Date() : null, updatedAt: new Date() }).where(and(eq(knowledgeGaps.organizationId, req.organization!.id), eq(knowledgeGaps.id, req.params.id))).returning();
    if (!updated) return res.status(404).json({ error: "Knowledge gap not found" });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.gap_status_changed", resourceType: "knowledge_gap", resourceId: updated.id, metadata: { status } });
    return res.json(updated);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_GAP_UPDATE_FAILED", message: "Unable to update knowledge gap" });
  }
});

router.get("/faq-drafts", async (req: AuthRequest, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
    return res.json(await KnowledgeIntelligenceService.listFaqDrafts(req.organization!.id, status, req.query.limit));
  } catch (error) {
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_FAQ_DRAFTS_FAILED", message: "Unable to load FAQ drafts" });
  }
});

router.post("/faq-drafts", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId, gapId, question, answer, language, category, tags, confidence, evidence } = req.body || {};
    if (typeof knowledgeBaseId !== "string" || typeof question !== "string" || typeof answer !== "string") return res.status(400).json({ error: "FAQ draft requires knowledgeBaseId, question and answer" });
    const draft = await KnowledgeIntelligenceService.createFaqDraft({ organizationId: req.organization!.id, knowledgeBaseId, gapId: typeof gapId === "string" ? gapId : undefined, question, answer, language: typeof language === "string" ? language : undefined, category: typeof category === "string" ? category : undefined, tags: Array.isArray(tags) ? tags : undefined, confidence: typeof confidence === "number" ? confidence : undefined, evidence: Array.isArray(evidence) ? evidence : undefined, createdByUserId: req.user!.id });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.faq_draft_created", resourceType: "knowledge_faq_draft", resourceId: draft.id });
    return res.status(201).json(draft);
  } catch (error) {
    const message = (error as Error).message;
    if (["Knowledge base not found", "Knowledge gap not found", "FAQ draft requires question and answer"].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_FAQ_DRAFT_CREATE_FAILED", message: "Unable to create FAQ draft" });
  }
});

router.patch("/faq-drafts/:id/review", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const status = typeof req.body?.status === "string" ? req.body.status.toUpperCase() : "";
    const updated = await KnowledgeIntelligenceService.reviewFaqDraft(req.organization!.id, req.params.id, status, req.user!.id);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.faq_draft_reviewed", resourceType: "knowledge_faq_draft", resourceId: updated.id, metadata: { status } });
    return res.json(updated);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FAQ draft not found") return res.status(404).json({ error: message });
    if (message === "Invalid FAQ review status") return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_FAQ_REVIEW_FAILED", message: "Unable to review FAQ draft" });
  }
});

router.post("/faq-drafts/:id/publish", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const published = await KnowledgeIntelligenceService.publishFaqDraft(req.organization!.id, req.params.id, req.user!.id);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.faq_published", resourceType: "knowledge_faq_draft", resourceId: published.id, metadata: { sourceId: published.publishedSourceId } });
    return res.json(published);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FAQ draft not found") return res.status(404).json({ error: message });
    if (message === "FAQ draft must be approved before publishing") return res.status(409).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_FAQ_PUBLISH_FAILED", message: "Unable to publish FAQ draft" });
  }
});

export default router;
