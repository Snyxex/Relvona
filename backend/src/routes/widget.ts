import { Router } from "express";
import { db, pool } from "../db/index.js";
import { conversationMessages, messageFeedback } from "../db/schema.js";
import { conversations } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { ConversationService } from "../services/conversationService.js";
import { createRateLimiter, validateInputLimits } from "../middleware/security.js";
import { setLogContext } from "../observability/logger.js";
import { TenantQuotaExceededError } from "../services/tenantQuotaService.js";
import crypto from "crypto";

const router = Router();
const widgetSessionSecret = process.env.WIDGET_SESSION_SECRET || process.env.JWT_SECRET_CURRENT || process.env.JWT_SECRET;
if (process.env.NODE_ENV === "production" && !widgetSessionSecret) throw new Error("WIDGET_SESSION_SECRET is required in production");
function signConversationAccess(data: { conversationId: string; organizationId: string; assistantId: string }) {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 })).toString("base64url");
  const signature = crypto.createHmac("sha256", widgetSessionSecret || "development-widget-session-secret").update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyConversationAccess(token: unknown, data: { conversationId: string; organizationId: string; assistantId: string }) {
  if (typeof token !== "string" || token.length > 2000) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = crypto.createHmac("sha256", widgetSessionSecret || "development-widget-session-secret").update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try { const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); return parsed.conversationId === data.conversationId && parsed.organizationId === data.organizationId && parsed.assistantId === data.assistantId && Number.isInteger(parsed.exp) && parsed.exp > Math.floor(Date.now() / 1000); } catch { return false; }
}
type PublicAssistant = { id: string; organization_id: string; name: string; welcome_message: string; primary_color: string; avatar_url: string | null; handoff_enabled: boolean; widget_allowed_origins: unknown; chat_page_enabled: boolean; widget_settings: Record<string, unknown> | null };
async function publicWidgetAssistant(id: string, widgetKey: string) { return (await pool.query("SELECT * FROM supportai_public_widget_assistant($1, $2)", [id, widgetKey])).rows[0] as PublicAssistant | undefined; }
function allowsRequestOrigin(req: { get(name: string): string | undefined }, assistant: PublicAssistant) {
  const origin = req.get("origin");
  const allowed = Array.isArray(assistant.widget_allowed_origins) ? assistant.widget_allowed_origins.filter((value): value is string => typeof value === "string") : [];
  return Boolean(origin && allowed.includes(origin));
}
async function authenticateWidget(req: { body?: any; query?: any; get(name: string): string | undefined }) {
  const assistantId = req.body?.assistantId ?? req.query?.assistantId;
  const widgetKey = req.body?.widgetKey ?? req.query?.widgetKey;
  if (typeof assistantId !== "string" || typeof widgetKey !== "string") return undefined;
  const assistant = await publicWidgetAssistant(assistantId, widgetKey);
  return assistant && allowsRequestOrigin(req, assistant) ? assistant : undefined;
}
function publicConfig(assistant: PublicAssistant) { return { assistantId: assistant.id, organizationId: assistant.organization_id, name: assistant.name, welcomeMessage: assistant.welcome_message, primaryColor: assistant.primary_color, avatarUrl: assistant.avatar_url, handoffEnabled: assistant.handoff_enabled, widgetSettings: assistant.widget_settings || {} }; }
function publicApiBase(req: { protocol: string; get(name: string): string | undefined }) { return `${req.protocol}://${req.get("host")}`; }

router.get("/config", createRateLimiter({ keyPrefix: "widget-config", limit: 60, windowMs: 60_000 }), async (req, res) => {
  try { const assistant = await authenticateWidget(req); if (!assistant) return res.status(401).json({ error: "Invalid widget integration or origin" }); setLogContext({ organizationId: assistant.organization_id }); return res.json(publicConfig(assistant)); }
  catch { return res.status(500).json({ error: "Unable to load assistant configuration" }); }
});
router.post("/session", createRateLimiter({ keyPrefix: "widget-session", limit: 12, windowMs: 60_000 }), async (req, res) => {
  try {
    const { organizationId } = req.body; const assistant = await authenticateWidget(req);
    if (!assistant || (organizationId && organizationId !== assistant.organization_id)) return res.status(401).json({ error: "Invalid widget integration or origin" });
    setLogContext({ organizationId: assistant.organization_id });
    // Opening a widget is not a support request. Create no customer,
    // conversation, analytics event, or database row until a message arrives.
    return res.json({ customerId: null, conversationId: null, state: "IDLE" });
  } catch { return res.status(500).json({ error: "Unable to start chat session" }); }
});
async function validateConversationRequest(req: any) { const assistant = await authenticateWidget(req); return assistant && req.body?.organizationId === assistant.organization_id ? assistant : undefined; }
async function conversationForMessage(assistant: PublicAssistant, body: any) {
  if (typeof body.conversationId === "string" && body.conversationId) {
    if (!verifyConversationAccess(body.conversationToken, { conversationId: body.conversationId, organizationId: assistant.organization_id, assistantId: assistant.id })) throw new Error("Invalid conversation session");
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, body.conversationId), eq(conversations.organizationId, assistant.organization_id), eq(conversations.assistantId, assistant.id))).limit(1);
    if (!conversation) throw new Error("Conversation not found");
    return { id: conversation.id, token: body.conversationToken };
  }
  const customer = await ConversationService.getOrCreateCustomer({ organizationId: assistant.organization_id, email: body.email, name: body.name, externalId: body.externalId });
  const conversation = await ConversationService.getOrCreateConversation({ organizationId: assistant.organization_id, assistantId: assistant.id, customerId: customer.id });
  return { id: conversation.id, token: signConversationAccess({ conversationId: conversation.id, organizationId: assistant.organization_id, assistantId: assistant.id }) };
}
router.post("/message", createRateLimiter({ keyPrefix: "widget-message", limit: 20, windowMs: 60_000 }), validateInputLimits, async (req, res) => {
  try {
    const { content } = req.body; const assistant = await validateConversationRequest(req);
    if (!assistant || !content) return res.status(401).json({ error: "Invalid widget integration, session, or origin" });
    const conversation = await conversationForMessage(assistant, req.body);
    setLogContext({ organizationId: assistant.organization_id, conversationId: conversation.id }); return res.json({ ...(await ConversationService.processCustomerMessage({ organizationId: assistant.organization_id, conversationId: conversation.id, content })), conversationAccessToken: conversation.token });
  } catch (error) { if (error instanceof TenantQuotaExceededError) { res.setHeader("Retry-After", error.retryAfterSeconds); return res.status(429).json({ error: error.message, retryAfterSeconds: error.retryAfterSeconds }); } return res.status(500).json({ error: "Unable to process message" }); }
});
router.post("/message/stream", createRateLimiter({ keyPrefix: "widget-stream", limit: 20, windowMs: 60_000 }), validateInputLimits, async (req, res) => {
  const { content } = req.body; const assistant = await validateConversationRequest(req);
  if (!assistant || !content) return res.status(401).json({ error: "Invalid widget integration, session, or origin" });
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const conversation = await conversationForMessage(assistant, req.body); const conversationId = conversation.id;
    setLogContext({ organizationId: assistant.organization_id, conversationId });
    send("status", { state: "thinking" });
    let streamedContent = false;
    const result = await ConversationService.processCustomerMessage({ organizationId: assistant.organization_id, conversationId, content, onToken: async (token) => { streamedContent = true; send("token", { content: token }); } });
    if (result.aiResponse?.content) {
      // Short-circuit answers (for example, an unsupported question) do not
      // produce provider tokens. Include their content in `complete` so the
      // widget can render it immediately without a page refresh.
      send("complete", { messageId: result.aiResponse.id, content: streamedContent ? undefined : result.aiResponse.content, conversationId, conversationAccessToken: conversation.token, customerId: result.customerMessage.senderId || undefined, state: result.state, handoffTriggered: result.handoffTriggered, ticketId: result.ticketId, ticketNumber: result.ticketNumber, ticketCreated: result.ticketCreated });
    } else {
      if (result.fallbackMessage) send("token", { content: result.fallbackMessage });
      send("complete", { conversationId, conversationAccessToken: conversation.token, customerId: result.customerMessage?.senderId || undefined, state: result.state, handoffTriggered: result.handoffTriggered, budgetFallback: result.budgetFallback, ticketId: result.ticketId, ticketNumber: result.ticketNumber, ticketCreated: result.ticketCreated });
    }
  }
  catch (error) { if (error instanceof TenantQuotaExceededError) send("error", { status: 429, error: error.message, retryAfterSeconds: error.retryAfterSeconds }); else send("error", { status: 500, error: "Unable to process message" }); } finally { res.end(); }
});
router.post("/feedback", createRateLimiter({ keyPrefix: "widget-feedback", limit: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const { conversationId, messageId, rating, reason } = req.body || {}; const assistant = await validateConversationRequest(req);
    if (!assistant || !conversationId || !verifyConversationAccess(req.body?.conversationToken, { conversationId, organizationId: assistant.organization_id, assistantId: assistant.id }) || !messageId || ![-1, 1].includes(rating) || (reason !== undefined && (typeof reason !== "string" || reason.length > 500))) return res.status(400).json({ error: "Invalid feedback" });
    const [message] = await db.select({ id: conversationMessages.id }).from(conversationMessages).where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.organizationId, assistant.organization_id), eq(conversationMessages.senderType, "ai"))).limit(1);
    if (!message) return res.status(404).json({ error: "AI message not found" });
    const [feedback] = await db.insert(messageFeedback).values({ organizationId: assistant.organization_id, conversationId, messageId, rating, reason: typeof reason === "string" ? reason.trim() || null : null }).onConflictDoUpdate({ target: [messageFeedback.organizationId, messageFeedback.conversationId, messageFeedback.messageId], set: { rating, reason: typeof reason === "string" ? reason.trim() || null : null, createdAt: new Date() } }).returning();
    return res.status(201).json({ id: feedback.id, rating: feedback.rating });
  } catch { return res.status(500).json({ error: "Unable to save feedback" }); }
});
router.get("/messages", createRateLimiter({ keyPrefix: "widget-messages", limit: 60, windowMs: 60_000 }), async (req, res) => {
  try { const assistant = await authenticateWidget(req); const { conversationId, organizationId, conversationToken } = req.query; if (!assistant || typeof conversationId !== "string" || organizationId !== assistant.organization_id || !verifyConversationAccess(conversationToken, { conversationId, organizationId: assistant.organization_id, assistantId: assistant.id })) return res.status(401).json({ error: "Invalid widget integration, session, or origin" }); setLogContext({ organizationId: assistant.organization_id, conversationId }); return res.json(await db.select().from(conversationMessages).where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.organizationId, assistant.organization_id))).orderBy(conversationMessages.createdAt)); }
  catch { return res.status(500).json({ error: "Unable to load messages" }); }
});
router.get("/page/:assistantId", async (req, res) => {
  const widgetKey = String(req.query.widgetKey || ""); const assistant = await publicWidgetAssistant(req.params.assistantId, widgetKey);
  if (!assistant || !assistant.chat_page_enabled) return res.status(404).send("Chat page not found");
  const apiBase = publicApiBase(req); const escapeAttribute = (value: string) => value.replace(/[&"<>]/g, (character) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[character]!));
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeAttribute(assistant.name)}</title></head><body><script src="${escapeAttribute(apiBase)}/public/widget.js?v=20260902-3" data-assistant-id="${escapeAttribute(assistant.id)}" data-widget-key="${escapeAttribute(widgetKey)}" data-api-base="${escapeAttribute(apiBase)}" data-auto-open="true"></script></body></html>`);
});
export default router;
