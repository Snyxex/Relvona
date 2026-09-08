import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { TicketService } from "../services/ticketService.js";
import { TicketCaseService } from "../services/ticketCaseService.js";
import { db } from "../db/index.js";
import { externalActors, externalTicketMessages } from "../db/externalTicketMessageSchema.js";
import { ticketComments, users, organizationMembers, tickets } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent"]));

router.get("/sla-policies", async (req: AuthRequest, res) => {
  try { return res.json(await TicketCaseService.listPolicies(req.organization!.id)); }
  catch (error) { return sendInternalError(req, res, error, { code: "SLA_POLICIES_LOAD_FAILED", message: "Unable to load SLA policies" }); }
});

router.put("/sla-policies/:priority", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { firstResponseMinutes, resolutionMinutes, enabled = true } = req.body || {};
    const policy = await TicketCaseService.upsertPolicy({
      organizationId: req.organization!.id,
      priority: req.params.priority,
      firstResponseMinutes: Number(firstResponseMinutes),
      resolutionMinutes: Number(resolutionMinutes),
      enabled: enabled !== false,
    });
    return res.json(policy);
  } catch (error) {
    if ((error as Error).message === "Invalid SLA durations") return res.status(400).json({ error: "Invalid SLA durations" });
    return sendInternalError(req, res, error, { code: "SLA_POLICY_UPDATE_FAILED", message: "Unable to update SLA policy" });
  }
});

router.get("/", async (req: AuthRequest, res) => {
  try {
    const { status, priority, assignedAgentId, page } = req.query;
    const list = await TicketService.listTickets({ organizationId: req.organization!.id, status: status as string, priority: priority as string, assignedAgentId: assignedAgentId as string, page: page ? parseInt(page as string) : 1 });
    return res.json(list);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "TICKETS_LIST_FAILED", message: "Unable to load tickets" });
  }
});

router.get("/:id/case", async (req: AuthRequest, res) => {
  try { return res.json(await TicketCaseService.detail(req.organization!.id, req.params.id)); }
  catch (error) {
    if ((error as Error).message === "Ticket not found") return res.status(404).json({ error: "Ticket not found" });
    return sendInternalError(req, res, error, { code: "TICKET_CASE_LOAD_FAILED", message: "Unable to load ticket case" });
  }
});

router.post("/", async (req: AuthRequest, res) => {
  try {
    const { customerId, conversationId, subject, description, priority, assignedAgentId, tags } = req.body;
    if (typeof customerId !== "string" || !/^[0-9a-f-]{36}$/i.test(customerId) || typeof subject !== "string" || !subject.trim() || subject.length > 300 || (conversationId !== undefined && (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId))) || (description !== undefined && (typeof description !== "string" || description.length > 10_000)) || (tags !== undefined && (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 64)))) return res.status(400).json({ error: "customerId and subject are required" });
    const ticket = await TicketService.createTicket({ organizationId: req.organization!.id, customerId, conversationId, subject: subject.trim(), description: description?.trim(), priority, assignedAgentId, tags: tags?.map((tag: string) => tag.trim()) });
    await TicketCaseService.ensureCase(req.organization!.id, ticket.id);
    await TicketCaseService.recordTransition({ organizationId: req.organization!.id, ticketId: ticket.id, actorUserId: req.user!.id, type: "ticket.created", toValue: ticket.status, metadata: { source: ticket.source } });
    return res.status(201).json(ticket);
  } catch (error) {
    const message = (error as Error).message;
    if (["Customer not found", "Conversation not found"].includes(message)) return res.status(404).json({ error: message });
    if (message === "Assigned agent is not a support member") return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "TICKET_CREATE_FAILED", message: "Unable to create ticket" });
  }
});

router.put("/:id", async (req: AuthRequest, res) => {
  try {
    const { status, priority, assignedAgentId, tags } = req.body;
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 64))) return res.status(400).json({ error: "Invalid ticket tags" });
    if (assignedAgentId !== undefined) {
      if (typeof assignedAgentId !== "string") return res.status(400).json({ error: "Invalid assigned agent" });
      const [member] = await db.select({ id: organizationMembers.id }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, req.organization!.id), eq(organizationMembers.userId, assignedAgentId))).limit(1);
      if (!member) return res.status(400).json({ error: "Assigned agent must belong to this organization" });
    }
    const [previous] = await db.select({ status: tickets.status, priority: tickets.priority, assignedAgentId: tickets.assignedAgentId }).from(tickets)
      .where(and(eq(tickets.organizationId, req.organization!.id), eq(tickets.id, req.params.id))).limit(1);
    if (!previous) return res.status(404).json({ error: "Ticket not found" });
    const updated = await TicketService.updateTicket({ organizationId: req.organization!.id, ticketId: req.params.id, status, priority, assignedAgentId, tags });
    if (!updated) return res.status(404).json({ error: "Ticket not found" });
    await TicketCaseService.syncTicketUpdate({
      organizationId: req.organization!.id,
      ticketId: updated.id,
      actorUserId: req.user!.id,
      previous,
      current: { status: updated.status, priority: updated.priority, assignedAgentId: updated.assignedAgentId },
    });
    return res.json(updated);
  } catch (error) {
    const message = (error as Error).message;
    if (["Invalid ticket status", "Invalid ticket priority", "Assigned agent is not a support member"].includes(message)) return res.status(400).json({ error: message });
    return sendInternalError(req, res, error, { code: "TICKET_UPDATE_FAILED", message: "Unable to update ticket" });
  }
});

router.get("/:id/comments", async (req: AuthRequest, res) => {
  try {
    const organizationId = req.organization!.id;
    const [localComments, externalComments] = await Promise.all([
      db.select({ comment: ticketComments, user: { id: users.id, name: users.name, email: users.email } })
        .from(ticketComments)
        .innerJoin(users, eq(ticketComments.userId, users.id))
        .where(and(eq(ticketComments.ticketId, req.params.id), eq(ticketComments.organizationId, organizationId))),
      db.select({ message: externalTicketMessages, actor: externalActors })
        .from(externalTicketMessages)
        .leftJoin(externalActors, eq(externalTicketMessages.actorId, externalActors.id))
        .where(and(eq(externalTicketMessages.ticketId, req.params.id), eq(externalTicketMessages.organizationId, organizationId))),
    ]);

    const timeline = [
      ...localComments.map((item) => ({
        ...item.comment,
        source: "local" as const,
        authorType: "internal_user" as const,
        displayType: item.comment.isInternal ? "internal_note" as const : "public_reply" as const,
        displayLabel: item.comment.isInternal ? "Interne Notiz" : "Öffentliche Antwort",
        author: {
          ...item.user,
          name: `${item.comment.isInternal ? "Interne Notiz" : "Öffentliche Antwort"} · ${item.user.name || item.user.email}`,
        },
      })),
      ...externalComments.map((item) => ({
        id: item.message.id,
        ticketId: item.message.ticketId,
        organizationId: item.message.organizationId,
        content: item.message.content,
        isInternal: item.message.visibility !== "public",
        createdAt: item.message.providerCreatedAt || item.message.createdAt,
        source: item.message.provider,
        authorType: "external" as const,
        displayType: "external_customer" as const,
        displayLabel: item.message.provider === "zendesk" ? "Zendesk-Kunde" : "Externer Kunde",
        externalMessageId: item.message.externalMessageId,
        author: item.actor ? {
          id: item.actor.externalId,
          name: `${item.message.provider === "zendesk" ? "Zendesk-Kunde" : "Externer Kunde"} · ${item.actor.displayName || item.actor.email || item.actor.externalId}`,
          email: item.actor.email,
          role: item.actor.role,
          provider: item.actor.provider,
        } : {
          id: item.message.externalMessageId,
          name: item.message.provider === "zendesk" ? "Zendesk-Kunde" : "Externer Kunde",
          email: null,
          role: "end-user",
          provider: item.message.provider,
        },
      })),
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return res.json(timeline);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "TICKET_COMMENTS_LOAD_FAILED", message: "Unable to load ticket comments" });
  }
});

router.post("/:id/comments", async (req: AuthRequest, res) => {
  try {
    const { content, isInternal } = req.body || {};
    if (typeof content !== "string" || !content.trim() || content.length > 10_000) return res.status(400).json({ error: "Content is required" });
    if (isInternal !== undefined && typeof isInternal !== "boolean") return res.status(400).json({ error: "isInternal must be boolean" });
    const internal = isInternal !== false;
    const comment = await TicketService.addComment({ organizationId: req.organization!.id, ticketId: req.params.id, userId: req.user!.id, content: content.trim(), isInternal: internal });
    await TicketCaseService.markFirstResponse({ organizationId: req.organization!.id, ticketId: req.params.id, actorUserId: req.user!.id });
    await TicketCaseService.recordTransition({
      organizationId: req.organization!.id,
      ticketId: req.params.id,
      actorUserId: req.user!.id,
      type: internal ? "comment.internal_added" : "comment.public_added",
      metadata: { commentId: comment.id },
    });
    return res.status(201).json(comment);
  } catch (error) {
    if ((error as Error).message === "Ticket not found") return res.status(404).json({ error: "Ticket not found" });
    return sendInternalError(req, res, error, { code: "TICKET_COMMENT_CREATE_FAILED", message: "Unable to add ticket comment" });
  }
});

export default router;