import { Router } from "express";
import { authenticate, tenantContext, AuthRequest } from "../middleware/auth.js";
import { AnalyticsService } from "../services/analyticsService.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

// GET /api/v1/analytics/overview
router.get("/overview", async (req: AuthRequest, res) => {
  try {
    const overview = await AnalyticsService.getOverviewMetrics(req.organization!.id);
    return res.json(overview);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
