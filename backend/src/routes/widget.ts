import { Router } from "express";
import { db, pool } from "../db/index.js";
import { conversationMessages, messageFeedback } from "../db/schema.js";
import { conversations } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { ConversationService } from "../services/conversationService.js";
import { SchedulingConversationBridgeService } from "../services/schedulingConversationBridgeService.js";
import { createRateLimiter, validateInputLimits } from "../middleware/security.js";
import { setLogContext } from "../observability/logger.js";
import { TenantQuotaExceededError } from "../services/tenantQuotaService.js";
import { createWidgetSessionToken, verifyWidgetSessionToken } from "../services/widgetSessionService.js";
import { VisitorIdentityService } from "../services/visitorIdentityService.js";

const router = Router();
type PublicAssistant = { id: string; organization_id: string; name: string; welcome_message: string; primary_color: string; avatar_url: string | null; handoff_enabled: boolean; widget_allowed_origins: unknown; chat_page_enabled: boolean; widget_settings: Record<string, unknown> | null };
async function publicWidgetAssistant(id: string, widgetKey: string) { return (await pool.query("SELECT * FROM supportai_public_widget_assistant($1, $2)", [id, widgetKey])).rows[0] as PublicAssistant | undefined; }
function allowsRequestOrigin(req: { get(name: string): string | undefined }, assistant: PublicAssistant) {
  const origin = req.get("origin");
  const allowed = Array.isArray(assistant.widget_allowed_origins) ? assistant.widget_allowed_origins.filter((value): value is string => typeof value === "string") : [];
  const hostedPageOrigin = `${req.get("x-forwarded-proto") || "http"}://${req.get("host")}`;
  if (origin) return allowed.includes(origin) || origin === hostedPageOrigin;
  const referer = req.get("referer");
  try { const url = referer ? new URL(referer) : undefined; return Boolean(url && url.origin === hostedPageOrigin && url.pathname.startsWith("/api/v1/widget/page/")); } catch { return false; }
}
async function authenticateWidget(req: { body?: any; query?: any; get(name: string): string | undefined }) {
  const assistantId = req.body?.assistantId ?? req.query?.assistantId; const widgetKey = req.body?.widgetKey ?? req.query?.widgetKey;
  if (typeof assistantId !== "string" || typeof widgetKey !== "string") return undefined;
  const assistant = await publicWidgetAssistant(assistantId, widgetKey); return assistant && allowsRequestOrigin(req, assistant) ? assistant : undefined;
}
function publicConfig(assistant: PublicAssistant) { return { assistantId: assistant.id, organizationId: assistant.organization_id, name: assistant.name, welcomeMessage: assistant.welcome_message, primaryColor: assistant.primary_color, avatarUrl: assistant.avatar_url, handoffEnabled: assistant.handoff_enabled, widgetSettings: assistant.widget_settings || {} }; }
function publicApiBase(req: { protocol: string; get(name: string): string | undefined }) { return `${req.protocol}://${req.get("host")}`; }

router.get("/config", createRateLimiter({ keyPrefix: "widget-config", limit: 60, windowMs: 60_000 }), async (req, res) => {
  try { const assistant = await authenticateWidget(req); if (!assistant) return res.status(401).json({ error: "Invalid widget integration or origin" }); setLogContext({ organizationId: assistant.organization_id }); return res.json(publicConfig(assistant)); }
  catch { return res.status(500).json({ error: "Unable to load assistant configuration" }); }
});
router.post("/session", createRateLimiter({ keyPrefix: "widget-session", limit: 12, windowMs: 60_000 }), async (req, res) => {
  try { const { organizationId } = req.body; const assistant = await authenticateWidget(req); if (!assistant || (organizationId && organizationId !== assistant.organization_id)) return res.status(401).json({ error: "Invalid widget integration or origin" }); setLogContext({ organizationId: assistant.organization_id }); return res.json({ customerId: null, conversationId: null, state: "IDLE" }); }
  catch { return res.status(500).json({ error: "Unable to start chat session" }); }
});
async function validateConversationRequest(req: any) { const assistant = await authenticateWidget(req); if (!assistant || req.body?.organizationId !== assistant.organization_id) return undefined; setLogContext({ organizationId: assistant.organization_id }); return assistant; }
async function conversationForMessage(assistant: PublicAssistant, body: any) {
  const visitor = await VisitorIdentityService.resolveVisitor(assistant.organization_id, body.visitorToken);
  if (typeof body.conversationId === "string" && body.conversationId) {
    if (!verifyWidgetSessionToken(body.conversationToken, { assistantId: assistant.id, organizationId: assistant.organization_id, conversationId: body.conversationId })) throw new Error("Invalid widget conversation session");
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, body.conversationId), eq(conversations.organizationId, assistant.organization_id), eq(conversations.assistantId, assistant.id))).limit(1);
    if (!conversation) throw new Error("Conversation not found");
    if (visitor) await VisitorIdentityService.linkConversation({ organizationId: assistant.organization_id, visitorId: visitor.id, conversationId: conversation.id });
    return { id: conversation.id, token: body.conversationToken as string, visitorId: visitor?.id };
  }
  const customer = await ConversationService.getOrCreateCustomer({ organizationId: assistant.organization_id, email: body.email, name: body.name, externalId: body.externalId });
  const conversation = await ConversationService.getOrCreateConversation({ organizationId: assistant.organization_id, assistantId: assistant.id, customerId: customer.id });
  if (visitor) await VisitorIdentityService.linkConversation({ organizationId: assistant.organization_id, visitorId: visitor.id, conversationId: conversation.id });
  return { id: conversation.id, token: createWidgetSessionToken({ assistantId: assistant.id, organizationId: assistant.organization_id, conversationId: conversation.id }), visitorId: visitor?.id };
}

router.post("/message", createRateLimiter({ keyPrefix: "widget-message", limit: 20, windowMs: 60_000 }), validateInputLimits, async (req, res) => {
  try {
    const { content } = req.body; const assistant = await validateConversationRequest(req);
    if (!assistant || !content) return res.status(401).json({ error: "Invalid widget integration, session, or origin" });
    const conversation = await conversationForMessage(assistant, req.body); setLogContext({ organizationId: assistant.organization_id, conversationId: conversation.id });
    const scheduling = await SchedulingConversationBridgeService.processIfHandled({ organizationId: assistant.organization_id, conversationId: conversation.id, content });
    const result = scheduling || await ConversationService.processCustomerMessage({ organizationId: assistant.organization_id, conversationId: conversation.id, content });
    return res.json({ ...result, conversationToken: conversation.token });
  } catch (error) { if (error instanceof TenantQuotaExceededError) { res.setHeader("Retry-After", error.retryAfterSeconds); return res.status(429).json({ error: error.message, retryAfterSeconds: error.retryAfterSeconds }); } return res.status(500).json({ error: "Unable to process message" }); }
});

router.post("/message/stream", createRateLimiter({ keyPrefix: "widget-stream", limit: 20, windowMs: 60_000 }), validateInputLimits, async (req, res) => {
  const { content } = req.body; const assistant = await validateConversationRequest(req); if (!assistant || !content) return res.status(401).json({ error: "Invalid widget integration, session, or origin" });
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const conversation = await conversationForMessage(assistant, req.body); const conversationId = conversation.id; setLogContext({ organizationId: assistant.organization_id, conversationId }); send("status", { state: "thinking" });
    const scheduling = await SchedulingConversationBridgeService.processIfHandled({ organizationId: assistant.organization_id, conversationId, content });
    let streamedContent = false;
    const result = scheduling || await ConversationService.processCustomerMessage({ organizationId: assistant.organization_id, conversationId, content, onToken: async (token) => { streamedContent = true; send("token", { content: token }); } });
    if (result.aiResponse?.content) send("complete", { messageId: result.aiResponse.id, content: streamedContent ? undefined : result.aiResponse.content, conversationId, conversationToken: conversation.token, customerId: result.customerMessage.senderId || undefined, state: result.state, handoffTriggered: result.handoffTriggered, ticketId: (result as any).ticketId, ticketNumber: (result as any).ticketNumber, ticketCreated: (result as any).ticketCreated, actionExecutionId: (result as any).actionExecutionId });
    else { if ((result as any).fallbackMessage) send("token", { content: (result as any).fallbackMessage }); send("complete", { conversationId, conversationToken: conversation.token, customerId: result.customerMessage?.senderId || undefined, state: result.state, handoffTriggered: result.handoffTriggered, budgetFallback: (result as any).budgetFallback, ticketId: (result as any).ticketId, ticketNumber: (result as any).ticketNumber, ticketCreated: (result as any).ticketCreated }); }
  } catch (error) { if (error instanceof TenantQuotaExceededError) send("error", { status: 429, error: error.message, retryAfterSeconds: error.retryAfterSeconds }); else send("error", { status: 500, error: "Unable to process message" }); } finally { res.end(); }
});

router.post("/feedback", createRateLimiter({ keyPrefix: "widget-feedback", limit: 30, windowMs: 60_000 }), async (req, res) => {
  try { const { conversationId, conversationToken, messageId, rating, reason } = req.body || {}; const assistant = await validateConversationRequest(req); if (!assistant || !verifyWidgetSessionToken(conversationToken, { assistantId: assistant.id, organizationId: assistant.organization_id, conversationId })) return res.status(401).json({ error: "Invalid widget conversation session" }); if (!messageId || ![-1, 1].includes(rating) || (reason !== undefined && (typeof reason !== "string" || reason.length > 500))) return res.status(400).json({ error: "Invalid feedback" }); const [message] = await db.select({ id: conversationMessages.id }).from(conversationMessages).where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.organizationId, assistant.organization_id), eq(conversationMessages.senderType, "ai"))).limit(1); if (!message) return res.status(404).json({ error: "AI message not found" }); const [feedback] = await db.insert(messageFeedback).values({ organizationId: assistant.organization_id, conversationId, messageId, rating, reason: typeof reason === "string" ? reason.trim() || null : null }).onConflictDoUpdate({ target: [messageFeedback.organizationId, messageFeedback.conversationId, messageFeedback.messageId], set: { rating, reason: typeof reason === "string" ? reason.trim() || null : null, createdAt: new Date() } }).returning(); return res.status(201).json({ id: feedback.id, rating: feedback.rating }); }
  catch { return res.status(500).json({ error: "Unable to save feedback" }); }
});
router.get("/messages", createRateLimiter({ keyPrefix: "widget-messages", limit: 60, windowMs: 60_000 }), async (req, res) => {
  try { const assistant = await authenticateWidget(req); const { conversationId, conversationToken, organizationId } = req.query; if (!assistant || typeof conversationId !== "string" || organizationId !== assistant.organization_id || !verifyWidgetSessionToken(conversationToken, { assistantId: assistant.id, organizationId: assistant.organization_id, conversationId })) return res.status(401).json({ error: "Invalid widget integration, session, or origin" }); setLogContext({ organizationId: assistant.organization_id, conversationId }); return res.json(await db.select().from(conversationMessages).where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.organizationId, assistant.organization_id))).orderBy(conversationMessages.createdAt)); }
  catch { return res.status(500).json({ error: "Unable to load messages" }); }
});
router.get("/page/:assistantId", async (req, res) => {
  const widgetKey = String(req.query.widgetKey || ""); const assistant = await publicWidgetAssistant(req.params.assistantId, widgetKey); if (!assistant || !assistant.chat_page_enabled) return res.status(404).send("Chat page not found");
  const apiBase = publicApiBase(req); const escapeAttribute = (value: string) => value.replace(/[&"<>]/g, (character) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[character]!)); const attrs = `data-assistant-id="${escapeAttribute(assistant.id)}" data-widget-key="${escapeAttribute(widgetKey)}" data-api-base="${escapeAttribute(apiBase)}"`;
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeAttribute(assistant.name)}</title></head><body><script src="${escapeAttribute(apiBase)}/public/widget.js?v=20260907-visitor-memory" ${attrs} data-auto-open="true"></script><script src="${escapeAttribute(apiBase)}/public/widget-privacy.js?v=20260907-1" ${attrs}></script></body></html>`);
});
export default router;
