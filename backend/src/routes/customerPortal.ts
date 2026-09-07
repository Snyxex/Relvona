import { Router, type Request, type Response, type NextFunction } from "express";
import { createRateLimiter } from "../middleware/security.js";
import { CustomerPortalService, type CustomerPortalSessionContext } from "../services/customerPortalService.js";

const router = Router();

interface PortalRequest extends Request {
  portalSession?: CustomerPortalSessionContext;
}

function bearerToken(req: Request) {
  return req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
}

async function requirePortalSession(req: PortalRequest, res: Response, next: NextFunction) {
  try {
    req.portalSession = await CustomerPortalService.authenticate(bearerToken(req));
    return next();
  } catch {
    return res.status(401).json({ error: "Portal authentication required" });
  }
}

router.post("/request-link", createRateLimiter({ keyPrefix: "customer-portal-link", limit: 6, windowMs: 15 * 60_000 }), async (req, res) => {
  const { organizationId, email } = req.body || {};
  if (typeof organizationId === "string" && typeof email === "string") {
    try { await CustomerPortalService.requestMagicLink({ organizationId, email }); } catch { /* enumeration safe */ }
  }
  return res.status(202).json({ status: "accepted" });
});

router.post("/verify", createRateLimiter({ keyPrefix: "customer-portal-verify", limit: 12, windowMs: 15 * 60_000 }), async (req, res) => {
  try { return res.json(await CustomerPortalService.consumeMagicLink(req.body?.token)); }
  catch { return res.status(401).json({ error: "Invalid or expired magic link" }); }
});

router.get("/me", requirePortalSession, async (req: PortalRequest, res) => {
  const session = req.portalSession!;
  return res.json({ customerId: session.customerId, email: session.email, organizationId: session.organizationId });
});

router.get("/dashboard", requirePortalSession, async (req: PortalRequest, res) => {
  try { return res.json(await CustomerPortalService.dashboard(req.portalSession!)); }
  catch { return res.status(500).json({ error: "Unable to load portal dashboard" }); }
});

router.post("/visitor-links", requirePortalSession, async (req: PortalRequest, res) => {
  try {
    if (req.body?.consent !== true) return res.status(400).json({ error: "Explicit consent is required" });
    const link = await CustomerPortalService.linkVisitor({ session: req.portalSession!, visitorToken: req.body?.visitorToken, consentVersion: typeof req.body?.consentVersion === "string" ? req.body.consentVersion : "v1" });
    return res.status(201).json({ visitorId: link.visitorId, consentedAt: link.consentedAt });
  } catch { return res.status(400).json({ error: "Unable to link visitor history" }); }
});

router.delete("/visitor-links/:visitorId", requirePortalSession, async (req: PortalRequest, res) => {
  try {
    await CustomerPortalService.revokeVisitorLink({ session: req.portalSession!, visitorId: req.params.visitorId });
    return res.status(204).end();
  } catch { return res.status(400).json({ error: "Unable to unlink visitor history" }); }
});

router.post("/logout", requirePortalSession, async (req, res) => {
  await CustomerPortalService.revokeSession(bearerToken(req));
  return res.status(204).end();
});

export default router;
