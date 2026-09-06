import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { TicketService } from "../services/ticketService.js";
import { db } from "../db/index.js";
import { ticketComments, users, organizationMembers } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
// Tickets contain customer data and may change operational ownership. They are
// an internal support surface, not a general member feature.
router.use(requireRole(["owner", "admin", "agent"]));

// GET /api/v1/tickets
router.get("/", async (req: AuthRequest, res) => {
  try {
    const { status, priority, assignedAgentId, page } = req.query;
    const tickets = await TicketService.listTickets({
      organizationId: req.organization!.id,
      status: status as string,
      priority: priority as string,
      assignedAgentId: assignedAgentId as string,
      page: page ? parseInt(page as string) : 1,
    });

    return res.json(tickets);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/tickets
router.post("/", async (req: AuthRequest, res) => {
  try {
    const { customerId, conversationId, subject, description, priority, assignedAgentId, tags } = req.body;
    if (typeof customerId !== "string" || !/^[0-9a-f-]{36}$/i.test(customerId) || typeof subject !== "string" || !subject.trim() || subject.length > 300 || (conversationId !== undefined && (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId))) || (description !== undefined && (typeof description !== "string" || description.length > 10_000)) || (tags !== undefined && (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 64)))) {
      return res.status(400).json({ error: "customerId and subject are required" });
    }

    const ticket = await TicketService.createTicket({
      organizationId: req.organization!.id,
      customerId,
      conversationId,
      subject: subject.trim(),
      description: description?.trim(),
      priority,
      assignedAgentId,
      tags: tags?.map((tag: string) => tag.trim()),
    });

    return res.status(201).json(ticket);
  } catch (error) {
    if (["Customer not found", "Conversation not found"].includes((error as Error).message)) {
      return res.status(404).json({ error: (error as Error).message });
    }
    if ((error as Error).message === "Assigned agent is not a support member") return res.status(400).json({ error: (error as Error).message });
    return res.status(500).json({ error: (error as Error).message });
  }
});

// PUT /api/v1/tickets/:id
router.put("/:id", async (req: AuthRequest, res) => {
  try {
    const { status, priority, assignedAgentId, tags } = req.body;
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 64))) return res.status(400).json({ error: "Invalid ticket tags" });
    if (assignedAgentId !== undefined) {
      if (typeof assignedAgentId !== "string") return res.status(400).json({ error: "Invalid assigned agent" });
      const [member] = await db.select({ id: organizationMembers.id }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, req.organization!.id), eq(organizationMembers.userId, assignedAgentId))).limit(1);
      if (!member) return res.status(400).json({ error: "Assigned agent must belong to this organization" });
    }
    const updated = await TicketService.updateTicket({
      organizationId: req.organization!.id,
      ticketId: req.params.id,
      status,
      priority,
      assignedAgentId,
      tags,
    });
    if (!updated) return res.status(404).json({ error: "Ticket not found" });

    return res.json(updated);
  } catch (error) {
    if (["Invalid ticket status", "Invalid ticket priority", "Assigned agent is not a support member"].includes((error as Error).message)) {
      return res.status(400).json({ error: (error as Error).message });
    }
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/v1/tickets/:id/comments
router.get("/:id/comments", async (req: AuthRequest, res) => {
  try {
    const comments = await db
      .select({
        comment: ticketComments,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(ticketComments)
      .innerJoin(users, eq(ticketComments.userId, users.id))
      .where(
        and(
          eq(ticketComments.ticketId, req.params.id),
          eq(ticketComments.organizationId, req.organization!.id)
        )
      );

    return res.json(
      comments.map((c) => ({
        ...c.comment,
        author: c.user,
      }))
    );
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/tickets/:id/comments
router.post("/:id/comments", async (req: AuthRequest, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== "string" || !content.trim() || content.length > 10_000) return res.status(400).json({ error: "Content is required" });

    const comment = await TicketService.addComment({
      organizationId: req.organization!.id,
      ticketId: req.params.id,
      userId: req.user!.id,
      content: content.trim(),
      // Ticket comments from this authenticated staff-only endpoint are never
      // client-controlled public messages.
      isInternal: true,
    });

    return res.status(201).json(comment);
  } catch (error) {
    if ((error as Error).message === "Ticket not found") return res.status(404).json({ error: "Ticket not found" });
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
