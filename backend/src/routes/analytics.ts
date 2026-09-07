import { Router } from "express";
import { authenticate, tenantContext, AuthRequest } from "../middleware/auth.js";
import { AnalyticsService } from "../services/analyticsService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

// GET /api/v1/analytics/overview
router.get("/overview", async (req: AuthRequest, res) => {
  try {
    const overview = await AnalyticsService.getOverviewMetrics(req.organization!.id);
    return res.json(overview);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "ANALYTICS_OVERVIEW_FAILED", message: "Unable to load analytics overview" });
  }
});

export default router;
