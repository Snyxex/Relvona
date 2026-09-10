import { Router, type Request, type Response, type NextFunction } from "express";
import { CustomerPortalService, type CustomerPortalSessionContext } from "../services/customerPortalService.js";
import { CustomerPortalAttachmentService } from "../services/customerPortalAttachmentService.js";

const router = Router();
const PORTAL_SESSION_COOKIE = "supportai_portal_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface PortalRequest extends Request {
  portalSession?: CustomerPortalSessionContext;
}

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

function clearPortalSessionCookie(res: Response) {
  res.clearCookie(PORTAL_SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/customer-portal",
    maxAge: SESSION_MAX_AGE_MS,
  });
}

async function requirePortalSession(req: PortalRequest, res: Response, next: NextFunction) {
  try {
    req.portalSession = await CustomerPortalService.authenticate(parseCookie(req, PORTAL_SESSION_COOKIE));
    return next();
  } catch {
    clearPortalSessionCookie(res);
    return res.status(401).json({ error: "Portal authentication required" });
  }
}

router.get("/tickets/:ticketId/attachments", requirePortalSession, async (req: PortalRequest, res) => {
  try {
    return res.json(await CustomerPortalAttachmentService.listTicketAttachments(req.portalSession!, req.params.ticketId));
  } catch (error) {
    return res.status((error as Error).message === "Ticket not found" ? 404 : 500).json({ error: "Unable to load attachments" });
  }
});

router.get("/tickets/:ticketId/attachments/:attachmentId/download", requirePortalSession, async (req: PortalRequest, res) => {
  try {
    return res.json(await CustomerPortalAttachmentService.ticketAttachmentDownloadUrl(
      req.portalSession!,
      req.params.ticketId,
      req.params.attachmentId,
    ));
  } catch (error) {
    return res.status((error as Error).message === "Attachment not found" ? 404 : 503).json({ error: "Attachment unavailable" });
  }
});

export default router;
