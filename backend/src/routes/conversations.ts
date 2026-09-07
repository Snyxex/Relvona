import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { ConversationService } from "../services/conversationService.js";
import { RAGService } from "../services/ragService.js";
import { db } from "../db/index.js";
import { conversations, conversationMessages, customers, conversationActivities, conversationHandoffs, conversationTags, conversationTagLinks, agentPresence, organizationMembers, users } from "../db/schema.js";
import { eq, and, desc, asc, gte, lte, ilike, isNull, or, sql, inArray } from "drizzle-orm";
import { ConversationWorkflowService } from "../services/conversationWorkflowService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 100_000;

function pagination(query: AuthRequest["query"]) {
  const requestedLimit = Number(query.limit ?? DEFAULT_PAGE_SIZE);
  const requestedOffset = Number(query.offset ?? 0);
  const limit = Number.isInteger(requestedLimit) ? Math.min(MAX_PAGE_SIZE, Math.max(1, requestedLimit)) : DEFAULT_PAGE_SIZE;
  const offset = Number.isInteger(requestedOffset) ? Math.min(MAX_OFFSET, Math.max(0, requestedOffset)) : 0;
  return { limit, offset };
}

router.use(authenticate);
router.use(tenantContext);
// Viewers can read the inbox; every mutation below remains limited to support staff.
router.use(requireRole(["owner", "admin", "agent", "viewer"]));
router.use((req, res, next) => req.method === "GET" ? next() : requireRole(["owner", "admin", "agent"])(req, res, next));

router.post("/:id/suggested-reply", async (req: AuthRequest, res) => {
  try {
    const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, req.params.id), eq(conversations.organizationId, req.organization!.id))).limit(1);
    if (!conversation?.assistantId) return res.status(404).json({ error: "Conversation assistant not found" });
    const history = await db.select().from(conversationMessages).where(and(eq(conversationMessages.conversationId, conversation.id), eq(conversationMessages.organizationId, req.organization!.id))).orderBy(desc(conversationMessages.createdAt)).limit(50);
    const latestCustomer = history.find((message) => message.senderType === "customer");
    if (!latestCustomer) return res.status(400).json({ error: "No customer question available" });
    const reply = await RAGService.generateSuggestedReply({ organizationId: req.organization!.id, assistantId: conversation.assistantId, customerQuery: latestCustomer.content, conversationHistory: history.filter((message) => message.id !== latestCustomer.id).reverse().map((message) => ({ role: message.senderType, content: message.content })) });
    return res.json(reply);
  } catch (error) {
    return sendInternalError(req, res, error, { status: 503, code: "SUGGESTED_REPLY_UNAVAILABLE", message: "Suggested reply is currently unavailable" });
  }
});

router.get("/", async (req: AuthRequest, res) => {
  try {
    const { state, priority, agentId, customerId, tagId, q, from, to, sort = "newest" } = req.query;
    const { limit, offset } = pagination(req.query);
    let whereClause = eq(conversations.organizationId, req.organization!.id);
    if (state) whereClause = and(whereClause, eq(conversations.state, state as string))!;
    if (priority) whereClause = and(whereClause, eq(conversations.priority, priority as string))!;
    if (agentId === "unassigned") whereClause = and(whereClause, isNull(conversations.assignedAgentId))!;
    else if (agentId) whereClause = and(whereClause, eq(conversations.assignedAgentId, agentId as string))!;
    if (customerId) whereClause = and(whereClause, eq(conversations.customerId, customerId as string))!;
    if (from && !Number.isNaN(Date.parse(from as string))) whereClause = and(whereClause, gte(conversations.updatedAt, new Date(from as string)))!;
    if (to && !Number.isNaN(Date.parse(to as string))) whereClause = and(whereClause, lte(conversations.updatedAt, new Date(to as string)))!;
    if (q && typeof q === "string" && q.length <= 200) whereClause = and(whereClause, or(ilike(customers.name, `%${q}%`), ilike(customers.email, `%${q}%`), sql`cast(${conversations.id} as text) ILIKE ${`%${q}%`}`, sql`EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.conversation_id = ${conversations.id} AND cm.organization_id = ${req.organization!.id} AND cm.content ILIKE ${`%${q}%`})`))!;
    if (tagId && typeof tagId === "string") whereClause = and(whereClause, sql`EXISTS (SELECT 1 FROM conversation_tag_links ctl WHERE ctl.conversation_id = ${conversations.id} AND ctl.organization_id = ${req.organization!.id} AND ctl.tag_id = ${tagId})`)!;

    // Bound every inbox query before rows reach application memory. This keeps
    // wildcard message search and tag hydration from becoming tenant-level DoS primitives.
    const list = await db.select({ conversation: conversations, customer: customers })
      .from(conversations)
      .innerJoin(customers, eq(conversations.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(limit)
      .offset(offset);
    const ordered = sort === "oldest_waiting" ? list.sort((a, b) => a.conversation.updatedAt.getTime() - b.conversation.updatedAt.getTime()) : sort === "priority" || sort === "sla_risk" ? list.sort((a, b) => (["URGENT", "HIGH", "NORMAL", "LOW"].indexOf(a.conversation.priority) - ["URGENT", "HIGH", "NORMAL", "LOW"].indexOf(b.conversation.priority)) || b.conversation.updatedAt.getTime() - a.conversation.updatedAt.getTime()) : list;
    const ids = ordered.map((row) => row.conversation.id);
    const links = ids.length ? await db.select({ conversationId: conversationTagLinks.conversationId, tag: conversationTags }).from(conversationTagLinks).innerJoin(conversationTags, eq(conversationTagLinks.tagId, conversationTags.id)).where(and(eq(conversationTagLinks.organizationId, req.organization!.id), inArray(conversationTagLinks.conversationId, ids))) : [];
    res.setHeader("X-Page-Limit", String(limit));
    res.setHeader("X-Page-Offset", String(offset));
    return res.json(ordered.map((item) => ({ ...item.conversation, customer: { id: item.customer.id, name: item.customer.name, email: item.customer.email }, tags: links.filter((link) => link.conversationId === item.conversation.id).map((link) => link.tag) })));
  } catch (error) {
    return sendInternalError(req, res, error, { code: "CONVERSATIONS_LIST_FAILED", message: "Unable to load conversations" });
  }
});

router.get("/meta/tags", async (req: AuthRequest, res) => res.json(await db.select().from(conversationTags).where(eq(conversationTags.organizationId, req.organization!.id)).orderBy(asc(conversationTags.name))));
router.post("/meta/tags", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  const { name, color = "slate" } = req.body || {};
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9 _-]{0,63}$/i.test(name)) return res.status(400).json({ error: "Invalid tag name" });
  try { const [tag] = await db.insert(conversationTags).values({ organizationId: req.organization!.id, name: name.trim().toLowerCase(), color }).returning(); return res.status(201).json(tag); } catch { return res.status(409).json({ error: "Tag already exists" }); }
});
router.get("/meta/agents", async (req: AuthRequest, res) => {
  const agents = await db.select({ id: users.id, name: users.name, email: users.email, role: organizationMembers.role, presence: agentPresence.status }).from(organizationMembers).innerJoin(users, eq(organizationMembers.userId, users.id)).leftJoin(agentPresence, and(eq(agentPresence.organizationId, organizationMembers.organizationId), eq(agentPresence.userId, organizationMembers.userId))).where(and(eq(organizationMembers.organizationId, req.organization!.id), eq(organizationMembers.status, "active"), inArray(organizationMembers.role, ["owner", "admin", "agent"])));
  return res.json(agents);
});
router.put("/meta/presence", async (req: AuthRequest, res) => { const { status } = req.body || {}; if (!["ONLINE", "AWAY", "OFFLINE"].includes(status)) return res.status(400).json({ error: "Invalid presence" }); const [presence] = await db.insert(agentPresence).values({ organizationId: req.organization!.id, userId: req.user!.id, status, updatedAt: new Date() }).onConflictDoUpdate({ target: [agentPresence.organizationId, agentPresence.userId], set: { status, updatedAt: new Date() } }).returning(); return res.json(presence); });

router.get("/:id/timeline", async (req: AuthRequest, res) => res.json(await db.select().from(conversationActivities).where(and(eq(conversationActivities.organizationId, req.organization!.id), eq(conversationActivities.conversationId, req.params.id))).orderBy(asc(conversationActivities.createdAt))));
router.get("/:id/handoff", async (req: AuthRequest, res) => {
  const [handoff] = await db.select().from(conversationHandoffs).where(and(eq(conversationHandoffs.organizationId, req.organization!.id), eq(conversationHandoffs.conversationId, req.params.id))).orderBy(desc(conversationHandoffs.createdAt)).limit(1);
  return handoff ? res.json(handoff) : res.status(404).json({ error: "No handoff recorded" });
});
router.post("/:id/transition", async (req: AuthRequest, res) => { try { return res.json(await ConversationWorkflowService.transition({ organizationId: req.organization!.id, conversationId: req.params.id, actorUserId: req.user!.id, target: req.body?.state })); } catch (error) { return res.status((error as Error).message.includes("not found") ? 404 : 409).json({ error: (error as Error).message }); } });
router.put("/:id/assignment", async (req: AuthRequest, res) => { try { const canManageAssignment = ["owner", "admin"].includes(req.organization!.role); return res.json(await ConversationWorkflowService.assign({ organizationId: req.organization!.id, conversationId: req.params.id, actorUserId: req.user!.id, assigneeId: req.body?.agentId || null, canManageAssignment })); } catch (error) { return res.status((error as Error).message.includes("not found") ? 404 : 409).json({ error: (error as Error).message }); } });
router.put("/:id/priority", async (req: AuthRequest, res) => { try { return res.json(await ConversationWorkflowService.changePriority({ organizationId: req.organization!.id, conversationId: req.params.id, actorUserId: req.user!.id, priority: req.body?.priority })); } catch (error) { return res.status(400).json({ error: (error as Error).message }); } });
router.put("/:id/tags", async (req: AuthRequest, res) => { try { await ConversationWorkflowService.setTags({ organizationId: req.organization!.id, conversationId: req.params.id, actorUserId: req.user!.id, tagIds: Array.isArray(req.body?.tagIds) ? req.body.tagIds : [] }); return res.status(204).end(); } catch (error) { return res.status(400).json({ error: (error as Error).message }); } });
router.post("/:id/internal-notes", async (req: AuthRequest, res) => { const { content } = req.body || {}; if (typeof content !== "string" || !content.trim() || content.length > 10_000) return res.status(400).json({ error: "Invalid note" }); try { return res.status(201).json(await ConversationWorkflowService.addInternalNote({ organizationId: req.organization!.id, conversationId: req.params.id, actorUserId: req.user!.id, actorName: req.user!.name, content: content.trim() })); } catch (error) { return res.status(404).json({ error: (error as Error).message }); } });

router.get("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const msgs = await db.select().from(conversationMessages).where(and(eq(conversationMessages.conversationId, req.params.id), eq(conversationMessages.organizationId, req.organization!.id))).orderBy(conversationMessages.createdAt);
    return res.json(msgs);
  } catch (error) {
    if ((error as Error).message === "Conversation not found") return res.status(404).json({ error: "Conversation not found" });
    return sendInternalError(req, res, error, { code: "CONVERSATION_MESSAGES_FAILED", message: "Unable to load conversation messages" });
  }
});

router.post("/:id/messages/:messageId/translation", async (req: AuthRequest, res) => {
  try {
    const { targetLanguage } = req.body || {};
    const [message] = await db.select().from(conversationMessages).where(and(eq(conversationMessages.id, req.params.messageId), eq(conversationMessages.conversationId, req.params.id), eq(conversationMessages.organizationId, req.organization!.id))).limit(1);
    const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, req.params.id), eq(conversations.organizationId, req.organization!.id))).limit(1);
    if (!message || !conversation || !conversation.assistantId) return res.status(404).json({ error: "Conversation message not found" });
    const translatedContent = await ConversationService.translateMessage({ organizationId: req.organization!.id, assistantId: conversation.assistantId, content: message.content, targetLanguage });
    return res.json({ messageId: message.id, originalContent: message.content, translatedContent, targetLanguage });
  } catch (error) {
    return sendInternalError(req, res, error, { status: 503, code: "TRANSLATION_UNAVAILABLE", message: "Message translation is currently unavailable" });
  }
});

router.post("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== "string" || !content.trim() || content.length > 10_000) return res.status(400).json({ error: "Content must be between 1 and 10,000 characters" });
    const agentMsg = await ConversationService.sendAgentMessage({ organizationId: req.organization!.id, conversationId: req.params.id, agentId: req.user!.id, agentName: req.user!.name, content });
    return res.status(201).json(agentMsg);
  } catch (error) {
    if ((error as Error).message === "Conversation not found") return res.status(404).json({ error: "Conversation not found" });
    if ((error as Error).message.includes("assigned to another agent") || (error as Error).message.includes("not ready for an agent reply")) return res.status(409).json({ error: (error as Error).message });
    return sendInternalError(req, res, error, { code: "AGENT_MESSAGE_FAILED", message: "Unable to send agent message" });
  }
});

router.post("/:id/resolve", async (req: AuthRequest, res) => {
  try {
    const updated = await ConversationWorkflowService.transition({ organizationId: req.organization!.id, conversationId: req.params.id, actorUserId: req.user!.id, target: "RESOLVED" });
    return res.json(updated);
  } catch (error) {
    if ((error as Error).message === "Conversation not found") return res.status(404).json({ error: "Conversation not found" });
    return sendInternalError(req, res, error, { code: "CONVERSATION_RESOLVE_FAILED", message: "Unable to resolve conversation" });
  }
});

export default router;
