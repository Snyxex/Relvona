import { Router } from "express";
import { authenticate, type AuthRequest, requireRole, tenantContext } from "../middleware/auth.js";
import { AuditService } from "../services/auditService.js";
import { MailServerService, type MailServerInput } from "../services/mailServerService.js";

const router = Router();
const testWindows = new Map<string, number[]>();

function ipOf(req: AuthRequest) {
  return req.ip || req.socket.remoteAddress || null;
}

function mailTestRateLimit(req: AuthRequest, res: any, next: any) {
  const key = `${req.user?.id}:${req.organization?.id}`;
  const now = Date.now();
  const attempts = (testWindows.get(key) || []).filter((time) => now - time < 60_000);
  if (attempts.length >= 5) return res.status(429).json({ error: "Zu viele Mailserver-Tests. Bitte versuchen Sie es in einer Minute erneut." });
  attempts.push(now);
  testWindows.set(key, attempts);
  next();
}

router.use(authenticate, tenantContext, requireRole(["owner", "admin"]));

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    return res.json({ settings: await MailServerService.get(req.organization!.id) });
  } catch (error) { next(error); }
});

router.put("/", async (req: AuthRequest, res) => {
  try {
    const body = (req.body || {}) as MailServerInput;
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return res.status(400).json({ error: "Aktiviert muss true oder false sein." });
    if (body.clearPassword !== undefined && typeof body.clearPassword !== "boolean") return res.status(400).json({ error: "Ungültige Passwortoption." });
    const settings = await MailServerService.save(req.organization!.id, body);
    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "settings.mail_server.update",
      resourceType: "mail_server_settings",
      resourceId: settings.id,
      metadata: {
        enabled: settings.enabled,
        host: settings.host,
        port: settings.port,
        security: settings.security,
        passwordUpdated: typeof body.password === "string" && body.password.length > 0,
        passwordCleared: body.clearPassword === true,
      },
      ipAddress: ipOf(req),
    });
    return res.json({ settings });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message || "Mailserver-Einstellungen konnten nicht gespeichert werden." });
  }
});

router.post("/test", mailTestRateLimit, async (req: AuthRequest, res) => {
  try {
    await MailServerService.verify(req.organization!.id, (req.body || {}) as MailServerInput);
    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "settings.mail_server.test",
      resourceType: "mail_server_settings",
      metadata: { valid: true },
      ipAddress: ipOf(req),
    });
    return res.json({ valid: true });
  } catch {
    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "settings.mail_server.test",
      resourceType: "mail_server_settings",
      metadata: { valid: false },
      ipAddress: ipOf(req),
    }).catch(() => undefined);
    return res.status(400).json({ valid: false, error: "Die Verbindung zum Mailserver konnte nicht hergestellt oder authentifiziert werden." });
  }
});

export default router;
