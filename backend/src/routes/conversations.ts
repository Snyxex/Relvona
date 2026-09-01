import { Router } from "express";
import { authenticate, tenantContext, AuthRequest } from "../middleware/auth.js";
import { ConversationService } from "../services/conversationService.js";
import { db } from "../db/index.js";
import { conversations, conversationMessages, customers } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

// GET /api/v1/conversations
router.get("/", async (req: AuthRequest, res) => {
  try {
    const { state } = req.query;
    let whereClause = eq(conversations.organizationId, req.organization!.id);

    if (state) {
      whereClause = and(whereClause, eq(conversations.state, state as string))!;
    }

    const list = await db
      .select({
        conversation: conversations,
        customer: customers,
      })
      .from(conversations)
      .innerJoin(customers, eq(conversations.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(conversations.updatedAt));

    return res.json(
      list.map((item) => ({
        ...item.conversation,
        customer: {
          id: item.customer.id,
          name: item.customer.name,
          email: item.customer.email,
        },
      }))
    );
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/v1/conversations/:id/messages
router.get("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const msgs = await db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, req.params.id),
          eq(conversationMessages.organizationId, req.organization!.id)
        )
      )
      .orderBy(conversationMessages.createdAt);

    return res.json(msgs);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/conversations/:id/messages (Agent responds)
router.post("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Content is required" });

    const agentMsg = await ConversationService.sendAgentMessage({
      organizationId: req.organization!.id,
      conversationId: req.params.id,
      agentId: req.user!.id,
      agentName: req.user!.name,
      content,
    });

    return res.status(201).json(agentMsg);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/conversations/:id/resolve
router.post("/:id/resolve", async (req: AuthRequest, res) => {
  try {
    const updated = await ConversationService.resolveConversation(req.organization!.id, req.params.id);
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
