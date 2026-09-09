import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { KnowledgeRevisionService } from "../services/knowledgeRevisionService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent", "viewer"]));

router.get("/:sourceId", async (req: AuthRequest, res) => {
  try {
    return res.json(await KnowledgeRevisionService.list(req.organization!.id, req.params.sourceId, req.query.limit));
  } catch (error) {
    if ((error as Error).message === "Knowledge source not found") return res.status(404).json({ error: "Knowledge source not found" });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_REVISIONS_LOAD_FAILED", message: "Unable to load knowledge revision history" });
  }
});

export default router;
