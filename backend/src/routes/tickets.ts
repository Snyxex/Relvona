import { Router } from "express";
import { authenticate, tenantContext, AuthRequest } from "../middleware/auth.js";
import { TicketService } from "../services/ticketService.js";
import { db } from "../db/index.js";
import { ticketComments, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

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
    if (!customerId || !subject) {
      return res.status(400).json({ error: "customerId and subject are required" });
    }

    const ticket = await TicketService.createTicket({
      organizationId: req.organization!.id,
      customerId,
      conversationId,
      subject,
      description,
      priority,
      assignedAgentId,
      tags,
    });

    return res.status(201).json(ticket);
  } catch (error) {
    if (["Customer not found", "Conversation not found"].includes((error as Error).message)) {
      return res.status(404).json({ error: (error as Error).message });
    }
    return res.status(500).json({ error: (error as Error).message });
  }
});

// PUT /api/v1/tickets/:id
router.put("/:id", async (req: AuthRequest, res) => {
  try {
    const { status, priority, assignedAgentId, tags } = req.body;
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
    if (["Invalid ticket status", "Invalid ticket priority"].includes((error as Error).message)) {
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
    const { content, isInternal } = req.body;
    if (!content) return res.status(400).json({ error: "Content is required" });

    const comment = await TicketService.addComment({
      organizationId: req.organization!.id,
      ticketId: req.params.id,
      userId: req.user!.id,
      content,
      isInternal,
    });

    return res.status(201).json(comment);
  } catch (error) {
    if ((error as Error).message === "Ticket not found") return res.status(404).json({ error: "Ticket not found" });
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
