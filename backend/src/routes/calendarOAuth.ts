import { Router } from "express";
import { authenticate, tenantContext, type AuthRequest } from "../middleware/auth.js";
import { CalendarOAuthService } from "../services/calendarOAuthService.js";
import { createRateLimiter } from "../middleware/security.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();

router.post("/:provider/start", authenticate, tenantContext, createRateLimiter({ keyPrefix: "calendar-oauth-start", limit: 10, windowMs: 60_000 }), async (req: AuthRequest, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== "google" && provider !== "microsoft") return res.status(400).json({ error: "Unsupported calendar provider" });
    const result = await CalendarOAuthService.start({ organizationId: req.organization!.id, userId: req.user!.id, provider, redirectAfter: req.body?.redirectAfter });
    return res.json(result);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "CALENDAR_OAUTH_START_FAILED", message: "Unable to start calendar connection" });
  }
});

router.get("/:provider/callback", createRateLimiter({ keyPrefix: "calendar-oauth-callback", limit: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== "google" && provider !== "microsoft") return res.status(400).send("Unsupported calendar provider");
    const result = await CalendarOAuthService.callback({ provider, state: req.query.state, code: req.query.code });
    const frontendBase = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
    return res.redirect(302, `${frontendBase}${result.redirectAfter}?calendar=${encodeURIComponent(provider)}&connected=1`);
  } catch {
    const frontendBase = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
    return res.redirect(302, `${frontendBase}/admin/settings/integrations?calendar=error`);
  }
});

export default router;
