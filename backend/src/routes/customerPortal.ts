import { Router, type Request, type Response, type NextFunction } from "express";
import { createRateLimiter } from "../middleware/security.js";
import { CustomerPortalService, type CustomerPortalSessionContext } from "../services/customerPortalService.js";
import { CustomerPortalSchedulingService } from "../services/customerPortalSchedulingService.js";

const router = Router();
const PORTAL_SESSION_COOKIE = "supportai_portal_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface PortalRequest extends Request { portalSession?: CustomerPortalSessionContext; }

function parseCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName === name) {
      try { return decodeURIComponent(rawValue.join("=")); } catch { return undefined; }
    }
  }
  return undefined;
}

function portalSessionToken(req: Request) {
  return parseCookie(req, PORTAL_SESSION_COOKIE);
}

function portalCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE_MS,
    path: "/api/v1/customer-portal",
  };
}

function setPortalSessionCookie(res: Response, token: string) {
  res.cookie(PORTAL_SESSION_COOKIE, token, portalCookieOptions());
}

function clearPortalSessionCookie(res: Response) {
  res.clearCookie(PORTAL_SESSION_COOKIE, { ...portalCookieOptions(), maxAge: undefined });
}

function trustedPortalOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const configured = new Set((process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((value) => value.trim()).filter(Boolean));
  const portalUrl = process.env.PORTAL_PUBLIC_URL;
  if (portalUrl) {
    try { configured.add(new URL(portalUrl).origin); } catch { /* invalid config is handled elsewhere */ }
  }
  return configured.has(origin);
}

function requirePortalOrigin(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!trustedPortalOrigin(req)) return res.status(403).json({ error: "Untrusted portal origin" });
  return next();
}

async function requirePortalSession(req: PortalRequest, res: Response, next: NextFunction) {
  try { req.portalSession = await CustomerPortalService.authenticate(portalSessionToken(req)); return next(); }
  catch { clearPortalSessionCookie(res); return res.status(401).json({ error: "Portal authentication required" }); }
}

router.use(requirePortalOrigin);

router.post("/request-link", createRateLimiter({ keyPrefix: "customer-portal-link", limit: 6, windowMs: 15 * 60_000 }), async (req, res) => {
  const { organizationId, email } = req.body || {};
  if (typeof organizationId === "string" && typeof email === "string") {
    try { await CustomerPortalService.requestMagicLink({ organizationId, email }); } catch { /* enumeration safe */ }
  }
  return res.status(202).json({ status: "accepted" });
});

router.post("/verify", createRateLimiter({ keyPrefix: "customer-portal-verify", limit: 12, windowMs: 15 * 60_000 }), async (req, res) => {
  try {
    const result = await CustomerPortalService.consumeMagicLink(req.body?.token);
    setPortalSessionCookie(res, result.sessionToken);
    return res.json({ status: "authenticated", expiresInSeconds: result.expiresInSeconds });
  } catch {
    clearPortalSessionCookie(res);
    return res.status(401).json({ error: "Invalid or expired magic link" });
  }
});

router.get("/me", requirePortalSession, async (req: PortalRequest, res) => {
  const session = req.portalSession!;
  return res.json({ customerId: session.customerId, email: session.email, organizationId: session.organizationId });
});
router.get("/dashboard", requirePortalSession, async (req: PortalRequest, res) => {
  try { return res.json(await CustomerPortalService.dashboard(req.portalSession!)); }
  catch { return res.status(500).json({ error: "Unable to load portal dashboard" }); }
});

router.get("/meetings", requirePortalSession, async (req: PortalRequest, res) => {
  try { return res.json(await CustomerPortalSchedulingService.list(req.portalSession!)); }
  catch { return res.status(500).json({ error: "Unable to load meetings" }); }
});
router.get("/meetings/:id/slots", requirePortalSession, async (req: PortalRequest, res) => {
  try {
    const from = new Date(typeof req.query.from === "string" ? req.query.from : Date.now());
    const to = new Date(typeof req.query.to === "string" ? req.query.to : Date.now() + 14 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return res.status(400).json({ error: "Invalid slot range" });
    return res.json(await CustomerPortalSchedulingService.slots(req.portalSession!, req.params.id, from, to));
  } catch (error) {
    return (error as Error).message === "Booking not found"
      ? res.status(404).json({ error: "Booking not found" })
      : res.status(400).json({ error: "Unable to load available slots" });
  }
});
router.post("/meetings/:id/reschedule", requirePortalSession, async (req: PortalRequest, res) => {
  try {
    const startsAt = new Date(req.body?.startsAt);
    const timezone = typeof req.body?.timezone === "string" ? req.body.timezone : "Europe/Berlin";
    if (Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: "Invalid booking time" });
    return res.json(await CustomerPortalSchedulingService.reschedule(req.portalSession!, req.params.id, startsAt, timezone));
  } catch (error) {
    const message = (error as Error).message;
    if (["Booking not found", "Booking conflict", "External calendar conflict", "Booking violates minimum notice", "Booking exceeds allowed future range", "Invalid booking time"].includes(message)) {
      return res.status(message === "Booking not found" ? 404 : 400).json({ error: message });
    }
    return res.status(500).json({ error: "Unable to reschedule meeting" });
  }
});
router.post("/meetings/:id/cancel", requirePortalSession, async (req: PortalRequest, res) => {
  try { return res.json(await CustomerPortalSchedulingService.cancel(req.portalSession!, req.params.id)); }
  catch (error) { return (error as Error).message === "Booking not found" ? res.status(404).json({ error: "Booking not found" }) : res.status(500).json({ error: "Unable to cancel meeting" }); }
});

router.post("/visitor-links", requirePortalSession, async (req: PortalRequest, res) => {
  try {
    if (req.body?.consent !== true) return res.status(400).json({ error: "Explicit consent is required" });
    const link = await CustomerPortalService.linkVisitor({ session: req.portalSession!, visitorToken: req.body?.visitorToken, consentVersion: typeof req.body?.consentVersion === "string" ? req.body.consentVersion : "v1" });
    return res.status(201).json({ visitorId: link.visitorId, consentedAt: link.consentedAt });
  } catch { return res.status(400).json({ error: "Unable to link visitor history" }); }
});
router.delete("/visitor-links/:visitorId", requirePortalSession, async (req: PortalRequest, res) => {
  try { await CustomerPortalService.revokeVisitorLink({ session: req.portalSession!, visitorId: req.params.visitorId }); return res.status(204).end(); }
  catch { return res.status(400).json({ error: "Unable to unlink visitor history" }); }
});
router.post("/logout", requirePortalSession, async (req, res) => {
  await CustomerPortalService.revokeSession(portalSessionToken(req));
  clearPortalSessionCookie(res);
  return res.status(204).end();
});

export default router;
