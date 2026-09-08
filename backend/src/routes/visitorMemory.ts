import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { anonymousVisitors, visitorMemories } from "../db/extendedCustomerExperienceSchema.js";
import { VisitorIdentityService } from "../services/visitorIdentityService.js";
import { AuditService } from "../services/auditService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent"]));

router.get("/", async (req: AuthRequest, res) => {
  try {
    const organizationId = req.organization!.id;
    const visitors = await db.select({
      id: anonymousVisitors.id,
      memoryEnabled: anonymousVisitors.memoryEnabled,
      firstSeenAt: anonymousVisitors.firstSeenAt,
      lastSeenAt: anonymousVisitors.lastSeenAt,
      createdAt: anonymousVisitors.createdAt,
      updatedAt: anonymousVisitors.updatedAt,
    }).from(anonymousVisitors)
      .where(eq(anonymousVisitors.organizationId, organizationId))
      .orderBy(desc(anonymousVisitors.lastSeenAt))
      .limit(250);
    return res.json(visitors);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "VISITORS_LIST_FAILED", message: "Unable to load anonymous visitors" });
  }
});

router.get("/:visitorId", async (req: AuthRequest, res) => {
  try {
    const organizationId = req.organization!.id;
    const [visitor] = await db.select({
      id: anonymousVisitors.id,
      memoryEnabled: anonymousVisitors.memoryEnabled,
      firstSeenAt: anonymousVisitors.firstSeenAt,
      lastSeenAt: anonymousVisitors.lastSeenAt,
      createdAt: anonymousVisitors.createdAt,
      updatedAt: anonymousVisitors.updatedAt,
    }).from(anonymousVisitors)
      .where(and(eq(anonymousVisitors.organizationId, organizationId), eq(anonymousVisitors.id, req.params.visitorId)))
      .limit(1);
    if (!visitor) return res.status(404).json({ error: "Visitor not found" });
    const [memories, conversations] = await Promise.all([
      VisitorIdentityService.memoriesForVisitor(organizationId, visitor.id, 100),
      VisitorIdentityService.conversationHistory(organizationId, visitor.id, 100),
    ]);
    return res.json({ ...visitor, memories, conversations });
  } catch (error) {
    return sendInternalError(req, res, error, { code: "VISITOR_LOAD_FAILED", message: "Unable to load anonymous visitor" });
  }
});

router.post("/:visitorId/memories", async (req: AuthRequest, res) => {
  try {
    const { type, summary, sourceConversationId, expiresAt, metadata } = req.body || {};
    if (typeof type !== "string" || typeof summary !== "string" || summary.length > 2_000) return res.status(400).json({ error: "Invalid visitor memory" });
    const parsedExpiry = expiresAt ? new Date(expiresAt) : undefined;
    if (parsedExpiry && Number.isNaN(parsedExpiry.getTime())) return res.status(400).json({ error: "Invalid memory expiry" });
    const memory = await VisitorIdentityService.createMemory({
      organizationId: req.organization!.id,
      visitorId: req.params.visitorId,
      type,
      summary,
      sourceConversationId: typeof sourceConversationId === "string" ? sourceConversationId : undefined,
      expiresAt: parsedExpiry,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : undefined,
    });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "visitor_memory.create", resourceType: "visitor_memory", resourceId: memory.id, metadata: { visitorId: req.params.visitorId, type: memory.type } });
    return res.status(201).json(memory);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "VISITOR_MEMORY_CREATE_FAILED", message: "Unable to create visitor memory" });
  }
});

router.post("/:visitorId/memories/:memoryId/resolve", async (req: AuthRequest, res) => {
  try {
    const memory = await VisitorIdentityService.resolveMemory({ organizationId: req.organization!.id, visitorId: req.params.visitorId, memoryId: req.params.memoryId });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "visitor_memory.resolve", resourceType: "visitor_memory", resourceId: memory.id, metadata: { visitorId: req.params.visitorId } });
    return res.json(memory);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "VISITOR_MEMORY_RESOLVE_FAILED", message: "Unable to resolve visitor memory" });
  }
});

router.delete("/:visitorId", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const [deleted] = await db.delete(anonymousVisitors)
      .where(and(eq(anonymousVisitors.organizationId, req.organization!.id), eq(anonymousVisitors.id, req.params.visitorId)))
      .returning({ id: anonymousVisitors.id });
    if (!deleted) return res.status(404).json({ error: "Visitor not found" });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "anonymous_visitor.erase", resourceType: "anonymous_visitor", resourceId: deleted.id });
    return res.status(202).json({ status: "erased", visitorId: deleted.id, erased: ["visitor_identity", "visitor_memories", "visitor_conversation_links"] });
  } catch (error) {
    return sendInternalError(req, res, error, { code: "VISITOR_ERASE_FAILED", message: "Unable to erase anonymous visitor data" });
  }
});

export default router;
