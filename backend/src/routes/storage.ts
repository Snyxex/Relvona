import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { withTenantTransaction } from "../db/index.js";
import { StorageQuotaService } from "../services/storageQuotaService.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin"]));

router.get("/usage", async (req: AuthRequest, res) => {
  try {
    const usage = await withTenantTransaction(req.organization!.id, (tx) =>
      StorageQuotaService.getUsage(tx, req.organization!.id),
    );
    return res.json(usage);
  } catch {
    return res.status(500).json({ error: "STORAGE_USAGE_UNAVAILABLE" });
  }
});

export default router;
