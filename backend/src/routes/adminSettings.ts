import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { analyticsEvents, auditLogs, messageFeedback, modelRoutingRules, organizationSettings, organizations, conversationMessages } from "../db/schema.js";
import { authenticate, AuthRequest, requirePlatformAdmin, requireRole, tenantContext } from "../middleware/auth.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";
import { AuditService } from "../services/auditService.js";
import { TenantQuotaService } from "../services/tenantQuotaService.js";
import { isIP } from "node:net";
import { isValidGitHubRepository } from "../services/githubIssueService.js";
import { ActiveDirectoryService, isValidActiveDirectoryUrl, isValidDistinguishedName } from "../services/activeDirectoryService.js";

const router = Router();
const allowedModels = new Set(["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo", "nvidia-mistral", "nvidia/llama-3.1-8b-instruct"]);
const requestWindows = new Map<string, number[]>();

function adminRateLimit(req: AuthRequest, res: any, next: any) {
  const key = `${req.user?.id}:${req.organization?.id}`;
  const now = Date.now();
  const attempts = (requestWindows.get(key) || []).filter((time) => now - time < 60_000);
  if (attempts.length >= 10) return res.status(429).json({ error: "Zu viele Admin-Anfragen. Bitte versuchen Sie es in einer Minute erneut." });
  attempts.push(now); requestWindows.set(key, attempts); next();
}

router.use(authenticate);
router.get("/organizations", requirePlatformAdmin, async (_req, res, next) => {
  try {
    res.json(await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug }).from(organizations).orderBy(organizations.name));
  } catch (error) { next(error); }
});
router.use(tenantContext, requireRole(["owner", "admin"]), adminRateLimit);

async function settingsFor(orgId: string) {
  const [existing] = await db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, orgId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(organizationSettings).values({ organizationId: orgId }).returning();
  return created;
}

function publicSettings(settings: typeof organizationSettings.$inferSelect) {
  const { openaiKeyEncrypted, nvidiaKeyEncrypted, githubTokenEncrypted, activeDirectoryBindPasswordEncrypted, ...safe } = settings;
  return {
    ...safe,
    openaiKeyConfigured: Boolean(openaiKeyEncrypted),
    nvidiaKeyConfigured: Boolean(nvidiaKeyEncrypted),
    githubTokenConfigured: Boolean(githubTokenEncrypted),
    activeDirectoryBindPasswordConfigured: Boolean(activeDirectoryBindPasswordEncrypted),
  };
}

function ipOf(req: AuthRequest) { return req.ip || req.socket.remoteAddress || null; }

// Enforced after session/RBAC, so a tenant can safely restrict its admin surface.
router.use(async (req: AuthRequest, res, next) => {
  try {
    const settings = await settingsFor(req.organization!.id);
    const whitelist = Array.isArray(settings.ipWhitelist) ? settings.ipWhitelist.filter((ip): ip is string => typeof ip === "string") : [];
    if (whitelist.length && (!ipOf(req) || !whitelist.includes(ipOf(req)!))) return res.status(403).json({ error: "Dieser Admin-Zugriff ist für Ihre IP-Adresse nicht freigegeben." });
    next();
  } catch (error) { next(error); }
});

router.get("/settings", async (req: AuthRequest, res) => {
  const settings = await settingsFor(req.organization!.id);
  const rules = await db.select().from(modelRoutingRules).where(eq(modelRoutingRules.organizationId, req.organization!.id)).orderBy(modelRoutingRules.priority);
  return res.json({ settings: publicSettings(settings), rules, organization: req.organization });
});

router.put("/settings/models", async (req: AuthRequest, res) => {
  const body = req.body || {};
  if (![body.primaryModel, body.fallbackModel, body.simpleModel].every((model: unknown) => typeof model === "string" && allowedModels.has(model))) return res.status(400).json({ error: "Ungültiges Modell." });
  if (!Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2 || !Number.isInteger(body.maxTokens) || body.maxTokens < 32 || body.maxTokens > 4096) return res.status(400).json({ error: "Ungültige Modellparameter." });
  const previous = await settingsFor(req.organization!.id);
  const [settings] = await db.update(organizationSettings).set({ primaryModel: body.primaryModel, fallbackModel: body.fallbackModel, simpleModel: body.simpleModel, temperature: body.temperature, maxTokens: body.maxTokens, updatedAt: new Date() }).where(eq(organizationSettings.organizationId, req.organization!.id)).returning();
  await db.delete(modelRoutingRules).where(eq(modelRoutingRules.organizationId, req.organization!.id));
  const rules = Array.isArray(body.rules) ? body.rules.slice(0, 20) : [];
  if (rules.length) await db.insert(modelRoutingRules).values(rules.map((rule: any, priority: number) => ({ organizationId: req.organization!.id, keywords: (Array.isArray(rule.keywords) ? rule.keywords : []).filter((keyword: unknown) => typeof keyword === "string").slice(0, 20), targetModel: allowedModels.has(rule.targetModel) ? rule.targetModel : body.primaryModel, priority, enabled: rule.enabled !== false })));
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "settings.models.update", resourceType: "organization_settings", resourceId: settings.id, metadata: { old: { primaryModel: previous.primaryModel }, new: { primaryModel: settings.primaryModel } }, ipAddress: ipOf(req) });
  return res.json({ settings: publicSettings(settings) });
});

router.put("/settings/quotas", async (req: AuthRequest, res) => {
  const body = req.body || {};
  if (!Number.isInteger(body.dailyTokenBudget) || body.dailyTokenBudget < 1_000 || body.dailyTokenBudget > 100_000_000 || !Number.isInteger(body.widgetRequestsPerMinute) || body.widgetRequestsPerMinute < 1 || body.widgetRequestsPerMinute > 100_000) return res.status(400).json({ error: "Ungültige Quoten." });
  const [settings] = await db.update(organizationSettings).set({ dailyTokenBudget: body.dailyTokenBudget, widgetRequestsPerMinute: body.widgetRequestsPerMinute, updatedAt: new Date() }).where(eq(organizationSettings.organizationId, req.organization!.id)).returning();
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "settings.quotas.update", resourceType: "organization_settings", resourceId: settings.id, metadata: { dailyTokenBudget: settings.dailyTokenBudget, widgetRequestsPerMinute: settings.widgetRequestsPerMinute }, ipAddress: ipOf(req) });
  return res.json({ settings: publicSettings(settings) });
});

router.put("/settings/api-keys", async (req: AuthRequest, res) => {
  const body = req.body || {};
  if (body.openaiKey !== undefined && (typeof body.openaiKey !== "string" || body.openaiKey.length > 500)) return res.status(400).json({ error: "Ungültiger OpenAI-Key." });
  if (body.nvidiaKey !== undefined && (typeof body.nvidiaKey !== "string" || body.nvidiaKey.length > 500)) return res.status(400).json({ error: "Ungültiger NVIDIA-Key." });
  const current = await settingsFor(req.organization!.id);
  const [settings] = await db.update(organizationSettings).set({ openaiKeyEncrypted: body.openaiKey ? encryptSecret(body.openaiKey) : current.openaiKeyEncrypted, nvidiaKeyEncrypted: body.nvidiaKey ? encryptSecret(body.nvidiaKey) : current.nvidiaKeyEncrypted, costAlertThreshold: Number.isFinite(body.costAlertThreshold) ? body.costAlertThreshold : current.costAlertThreshold, updatedAt: new Date() }).where(eq(organizationSettings.organizationId, req.organization!.id)).returning();
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "settings.api_keys.update", resourceType: "organization_settings", resourceId: settings.id, metadata: { providers: [body.openaiKey && "openai", body.nvidiaKey && "nvidia"].filter(Boolean) }, ipAddress: ipOf(req) });
  return res.json({ settings: publicSettings(settings) });
});

router.post("/settings/test-key", async (req: AuthRequest, res) => {
  const { provider, apiKey } = req.body || {};
  if (!(["openai", "nvidia"].includes(provider)) || typeof apiKey !== "string" || !apiKey.trim()) return res.status(400).json({ error: "Provider und API-Key sind erforderlich." });
  const endpoint = provider === "openai" ? "https://api.openai.com/v1/models" : "https://integrate.api.nvidia.com/v1/models";
  try {
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8_000) });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "settings.api_key.test", resourceType: "api_key", metadata: { provider, valid: response.ok }, ipAddress: ipOf(req) });
    return res.status(response.ok ? 200 : 400).json({ valid: response.ok, error: response.ok ? undefined : "Der API-Key wurde abgelehnt." });
  } catch { return res.status(503).json({ error: "Key-Validierung momentan nicht erreichbar." }); }
});

router.get("/settings/usage", async (req: AuthRequest, res) => {
  const since = new Date(); since.setDate(since.getDate() - (req.query.days === "30" ? 30 : 7));
  const events = await db.select({ eventType: analyticsEvents.eventType, count: sql<number>`count(*)` }).from(analyticsEvents).where(and(eq(analyticsEvents.organizationId, req.organization!.id), gte(analyticsEvents.createdAt, since))).groupBy(analyticsEvents.eventType);
  const settings = await settingsFor(req.organization!.id);
  const reservedTokensToday = await TenantQuotaService.currentDailyTokenUsage(req.organization!.id);
  return res.json({ periodDays: req.query.days === "30" ? 30 : 7, events, tokenUsageAvailable: reservedTokensToday !== null, reservedTokensToday, dailyTokenBudget: settings.dailyTokenBudget, usageAccounting: "reserved-estimate", message: "Provider usage is reconciled when the gateway exposes provider token metadata." });
});

router.get("/settings/audit-logs", async (req: AuthRequest, res) => {
  const logs = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, req.organization!.id)).orderBy(desc(auditLogs.createdAt)).limit(100);
  return res.json(logs);
});

router.put("/settings/github", async (req: AuthRequest, res) => {
  const body = req.body || {};
  const current = await settingsFor(req.organization!.id);
  const enabled = body.githubIssuesEnabled === true;
  const repository = typeof body.githubRepository === "string" ? body.githubRepository.trim() : current.githubRepository;
  const suppliedToken = typeof body.githubToken === "string" ? body.githubToken.trim() : "";
  if (body.githubIssuesEnabled !== undefined && typeof body.githubIssuesEnabled !== "boolean") return res.status(400).json({ error: "GitHub-Integration muss aktiviert oder deaktiviert werden." });
  if (body.githubRepository !== undefined && !isValidGitHubRepository(repository)) return res.status(400).json({ error: "Repository muss dem Format organisation/repository entsprechen." });
  if (body.githubToken !== undefined && (!suppliedToken || suppliedToken.length > 500)) return res.status(400).json({ error: "Ungültiger GitHub-Token." });
  if (enabled && (!isValidGitHubRepository(repository) || !(suppliedToken || current.githubTokenEncrypted))) return res.status(400).json({ error: "Für die aktivierte Integration sind Repository und GitHub-Token erforderlich." });
  const [settings] = await db.update(organizationSettings).set({
    githubIssuesEnabled: enabled,
    githubRepository: repository || null,
    githubTokenEncrypted: suppliedToken ? encryptSecret(suppliedToken) : current.githubTokenEncrypted,
    updatedAt: new Date(),
  }).where(eq(organizationSettings.organizationId, req.organization!.id)).returning();
  await AuditService.logAction({
    organizationId: req.organization!.id,
    actorUserId: req.user!.id,
    action: "settings.github.update",
    resourceType: "organization_settings",
    resourceId: settings.id,
    metadata: { enabled: settings.githubIssuesEnabled, repository: settings.githubRepository, tokenUpdated: Boolean(suppliedToken) },
    ipAddress: ipOf(req),
  });
  return res.json({ settings: publicSettings(settings) });
});

router.post("/settings/github/test", async (req: AuthRequest, res) => {
  const current = await settingsFor(req.organization!.id);
  const repository = typeof req.body?.githubRepository === "string" ? req.body.githubRepository.trim() : current.githubRepository;
  const suppliedToken = typeof req.body?.githubToken === "string" ? req.body.githubToken.trim() : "";
  const token = suppliedToken || decryptSecret(current.githubTokenEncrypted);
  if (!isValidGitHubRepository(repository) || !token) return res.status(400).json({ error: "Repository und GitHub-Token sind erforderlich." });
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "SupportAI-Platform" },
      signal: AbortSignal.timeout(8_000),
    });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "settings.github.test", resourceType: "github_repository", metadata: { repository, valid: response.ok }, ipAddress: ipOf(req) });
    return res.status(response.ok ? 200 : 400).json({ valid: response.ok, error: response.ok ? undefined : "Repository oder Token wurde von GitHub abgelehnt." });
  } catch { return res.status(503).json({ error: "GitHub ist momentan nicht erreichbar." }); }
});

router.post("/settings/active-directory/test", async (req: AuthRequest, res) => {
  const current = await settingsFor(req.organization!.id);
  const suppliedPassword = typeof req.body?.activeDirectoryBindPassword === "string" ? req.body.activeDirectoryBindPassword.trim() : "";
  const settings = {
    activeDirectoryEnabled: true,
    activeDirectoryUrl: typeof req.body?.activeDirectoryUrl === "string" ? req.body.activeDirectoryUrl.trim() : current.activeDirectoryUrl,
    activeDirectoryBaseDn: typeof req.body?.activeDirectoryBaseDn === "string" ? req.body.activeDirectoryBaseDn.trim() : current.activeDirectoryBaseDn,
    activeDirectoryBindDn: typeof req.body?.activeDirectoryBindDn === "string" ? req.body.activeDirectoryBindDn.trim() : current.activeDirectoryBindDn,
    activeDirectoryBindPasswordEncrypted: suppliedPassword ? encryptSecret(suppliedPassword) : current.activeDirectoryBindPasswordEncrypted,
  };
  if (!isValidActiveDirectoryUrl(settings.activeDirectoryUrl) || !isValidDistinguishedName(settings.activeDirectoryBaseDn) || !isValidDistinguishedName(settings.activeDirectoryBindDn) || !settings.activeDirectoryBindPasswordEncrypted) return res.status(400).json({ error: "LDAPS-URL, Base DN, Bind DN und Passwort sind erforderlich." });
  const valid = await ActiveDirectoryService.verifyConfiguration(settings, req.organization!.id);
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "settings.active_directory.test", resourceType: "active_directory", metadata: { valid }, ipAddress: ipOf(req) });
  return res.status(valid ? 200 : 400).json({ valid, error: valid ? undefined : "Die Verbindung oder das Bind-Konto wurde abgelehnt." });
});

router.get("/settings/answer-feedback", async (req: AuthRequest, res) => {
  const feedback = await db.select({ id: messageFeedback.id, rating: messageFeedback.rating, reason: messageFeedback.reason, createdAt: messageFeedback.createdAt, messageId: messageFeedback.messageId, answer: conversationMessages.content }).from(messageFeedback).innerJoin(conversationMessages, eq(messageFeedback.messageId, conversationMessages.id)).where(eq(messageFeedback.organizationId, req.organization!.id)).orderBy(desc(messageFeedback.createdAt)).limit(100);
  return res.json(feedback);
});

router.put("/settings/organization", async (req: AuthRequest, res) => {
  const body = req.body || {}; const current = await settingsFor(req.organization!.id);
  if (body.sessionTimeout !== undefined && (!Number.isInteger(body.sessionTimeout) || body.sessionTimeout < 5 || body.sessionTimeout > 10_080)) return res.status(400).json({ error: "Session-Timeout muss zwischen 5 und 10.080 Minuten liegen." });
  if (body.apiKeyExpiryDays !== undefined && (!Number.isInteger(body.apiKeyExpiryDays) || body.apiKeyExpiryDays < 1 || body.apiKeyExpiryDays > 3_650)) return res.status(400).json({ error: "API-Key-Rotation muss zwischen 1 und 3.650 Tagen liegen." });
  if (body.resolvedAutoCloseHours !== undefined && body.resolvedAutoCloseHours !== null && (!Number.isInteger(body.resolvedAutoCloseHours) || body.resolvedAutoCloseHours < 1 || body.resolvedAutoCloseHours > 87_600)) return res.status(400).json({ error: "Auto-Close muss zwischen 1 und 87.600 Stunden liegen oder deaktiviert werden." });
  if (body.ipWhitelist !== undefined && (!Array.isArray(body.ipWhitelist) || body.ipWhitelist.length > 100 || body.ipWhitelist.some((ip: unknown) => typeof ip !== "string" || !isIP(ip.trim())))) return res.status(400).json({ error: "IP-Whitelist darf nur gültige IP-Adressen enthalten." });
  const activeDirectoryEnabled = typeof body.activeDirectoryEnabled === "boolean" ? body.activeDirectoryEnabled : current.activeDirectoryEnabled;
  const activeDirectoryUrl = typeof body.activeDirectoryUrl === "string" ? body.activeDirectoryUrl.trim() : current.activeDirectoryUrl;
  const activeDirectoryBaseDn = typeof body.activeDirectoryBaseDn === "string" ? body.activeDirectoryBaseDn.trim() : current.activeDirectoryBaseDn;
  const activeDirectoryBindDn = typeof body.activeDirectoryBindDn === "string" ? body.activeDirectoryBindDn.trim() : current.activeDirectoryBindDn;
  const activeDirectoryBindPassword = typeof body.activeDirectoryBindPassword === "string" ? body.activeDirectoryBindPassword.trim() : "";
  if (body.activeDirectoryEnabled !== undefined && typeof body.activeDirectoryEnabled !== "boolean") return res.status(400).json({ error: "Active Directory muss aktiviert oder deaktiviert werden." });
  if (activeDirectoryEnabled && (!isValidActiveDirectoryUrl(activeDirectoryUrl) || !isValidDistinguishedName(activeDirectoryBaseDn) || !isValidDistinguishedName(activeDirectoryBindDn) || !(activeDirectoryBindPassword || current.activeDirectoryBindPasswordEncrypted))) return res.status(400).json({ error: "Für Active Directory sind LDAPS-URL, Base DN, Bind DN und Passwort erforderlich." });
  const [organization] = await db.update(organizations).set({ name: typeof body.name === "string" ? body.name.slice(0, 120) : req.organization!.name, updatedAt: new Date() }).where(eq(organizations.id, req.organization!.id)).returning();
  const [settings] = await db.update(organizationSettings).set({ supportEmail: typeof body.supportEmail === "string" ? body.supportEmail : current.supportEmail, businessHours: body.businessHours || current.businessHours, primaryLanguage: typeof body.primaryLanguage === "string" ? body.primaryLanguage : current.primaryLanguage, fallbackLanguages: Array.isArray(body.fallbackLanguages) ? body.fallbackLanguages.slice(0, 10) : current.fallbackLanguages, logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : current.logoUrl, sessionTimeout: Number.isInteger(body.sessionTimeout) ? body.sessionTimeout : current.sessionTimeout, apiKeyExpiryDays: Number.isInteger(body.apiKeyExpiryDays) ? body.apiKeyExpiryDays : current.apiKeyExpiryDays, resolvedAutoCloseHours: body.resolvedAutoCloseHours === null ? null : Number.isInteger(body.resolvedAutoCloseHours) ? body.resolvedAutoCloseHours : current.resolvedAutoCloseHours, ipWhitelist: Array.isArray(body.ipWhitelist) ? body.ipWhitelist.map((ip: string) => ip.trim()) : current.ipWhitelist, activeDirectoryEnabled, activeDirectoryUrl: activeDirectoryUrl || null, activeDirectoryBaseDn: activeDirectoryBaseDn || null, activeDirectoryBindDn: activeDirectoryBindDn || null, activeDirectoryBindPasswordEncrypted: activeDirectoryBindPassword ? encryptSecret(activeDirectoryBindPassword) : current.activeDirectoryBindPasswordEncrypted, updatedAt: new Date() }).where(eq(organizationSettings.organizationId, req.organization!.id)).returning();
  await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "settings.organization.update", resourceType: "organization_settings", resourceId: settings.id, metadata: { changed: Object.keys(body).filter((key) => !key.toLowerCase().includes("key") && !key.toLowerCase().includes("password")) }, ipAddress: ipOf(req) });
  return res.json({ organization, settings: publicSettings(settings) });
});

export default router;
