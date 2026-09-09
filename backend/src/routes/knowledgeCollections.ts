import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { KnowledgeCollectionService } from "../services/knowledgeCollectionService.js";
import { AuditService } from "../services/auditService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent", "viewer"]));

router.get("/", async (req: AuthRequest, res) => {
  try { return res.json(await KnowledgeCollectionService.list(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "KNOWLEDGE_COLLECTIONS_LOAD_FAILED", message: "Unable to load knowledge collections" }); }
});

router.post("/", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const created = await KnowledgeCollectionService.create(req.organization!.id, req.body || {});
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.collection_created", resourceType: "knowledge_collection", resourceId: created.id });
    return res.status(201).json(created);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("Collection name") || message.includes("description")) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_COLLECTION_CREATE_FAILED", message: "Unable to create knowledge collection" });
  }
});

router.patch("/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const updated = await KnowledgeCollectionService.update(req.organization!.id, req.params.id, req.body || {});
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.collection_updated", resourceType: "knowledge_collection", resourceId: updated.id });
    return res.json(updated);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Knowledge collection not found") return res.status(404).json({ error: message });
    if (message.includes("Collection name") || message.includes("description")) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_COLLECTION_UPDATE_FAILED", message: "Unable to update knowledge collection" });
  }
});

router.delete("/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const deleted = await KnowledgeCollectionService.remove(req.organization!.id, req.params.id);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.collection_deleted", resourceType: "knowledge_collection", resourceId: deleted.id });
    return res.status(204).send();
  } catch (error) {
    if ((error as Error).message === "Knowledge collection not found") return res.status(404).json({ error: "Knowledge collection not found" });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_COLLECTION_DELETE_FAILED", message: "Unable to delete knowledge collection" });
  }
});

router.put("/sources/:sourceId", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const result = await KnowledgeCollectionService.setSourceCollections(req.organization!.id, req.params.sourceId, req.body?.collectionIds);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.source_collections_updated", resourceType: "knowledge_source", resourceId: req.params.sourceId, metadata: { collectionIds: result.collectionIds } });
    return res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Knowledge source not found" || message.includes("knowledge collections were not found")) return res.status(404).json({ error: message });
    if (message.startsWith("collectionIds")) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_SOURCE_COLLECTIONS_FAILED", message: "Unable to update source collections" });
  }
});

router.get("/assistants/:assistantId", async (req: AuthRequest, res) => {
  try { return res.json(await KnowledgeCollectionService.getAssistantScope(req.organization!.id, req.params.assistantId)); }
  catch (error) { return sendInternalError(req, res, error, { code: "ASSISTANT_KNOWLEDGE_SCOPE_LOAD_FAILED", message: "Unable to load assistant knowledge scope" }); }
});

router.put("/assistants/:assistantId", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const result = await KnowledgeCollectionService.setAssistantCollections(req.organization!.id, req.params.assistantId, req.body?.collectionIds);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge.assistant_scope_updated", resourceType: "assistant", resourceId: req.params.assistantId, metadata: { collectionIds: result.collectionIds, unrestricted: result.unrestricted } });
    return res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Assistant not found" || message.includes("knowledge collections were not found")) return res.status(404).json({ error: message });
    if (message.startsWith("collectionIds")) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "ASSISTANT_KNOWLEDGE_SCOPE_FAILED", message: "Unable to update assistant knowledge scope" });
  }
});

export default router;
