import { Router } from "express";
import { db } from "../db/index.js";
import { assistants, organizations, conversations, conversationMessages } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { ConversationService } from "../services/conversationService.js";

const router = Router();

// GET /api/v1/widget/config
router.get("/config", async (req, res) => {
  try {
    const { assistantId, apiKey } = req.query;

    let targetAssistant = null;

    if (assistantId) {
      [targetAssistant] = await db
        .select()
        .from(assistants)
        .where(eq(assistants.id, assistantId as string))
        .limit(1);
    } else if (apiKey) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.apiKey, apiKey as string))
        .limit(1);

      if (org) {
        [targetAssistant] = await db
          .select()
          .from(assistants)
          .where(eq(assistants.organizationId, org.id))
          .limit(1);
      }
    }

    if (!targetAssistant) {
      return res.status(404).json({ error: "Assistant configuration not found" });
    }

    return res.json({
      assistantId: targetAssistant.id,
      organizationId: targetAssistant.organizationId,
      name: targetAssistant.name,
      welcomeMessage: targetAssistant.welcomeMessage,
      primaryColor: targetAssistant.primaryColor,
      avatarUrl: targetAssistant.avatarUrl,
      handoffEnabled: targetAssistant.handoffEnabled,
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/widget/session
router.post("/session", async (req, res) => {
  try {
    const { assistantId, organizationId, email, name, externalId } = req.body;

    if (!organizationId) {
      return res.status(400).json({ error: "organizationId is required" });
    }

    // 1. Get or create customer
    const customer = await ConversationService.getOrCreateCustomer({
      organizationId,
      email,
      name,
      externalId,
    });

    // 2. Get or create active conversation
    const conversation = await ConversationService.getOrCreateConversation({
      organizationId,
      assistantId,
      customerId: customer.id,
    });

    return res.json({
      customerId: customer.id,
      conversationId: conversation.id,
      state: conversation.state,
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/widget/message (Public chat message endpoint)
router.post("/message", async (req, res) => {
  try {
    const { organizationId, conversationId, content } = req.body;

    if (!organizationId || !conversationId || !content) {
      return res.status(400).json({ error: "organizationId, conversationId, and content are required" });
    }

    const result = await ConversationService.processCustomerMessage({
      organizationId,
      conversationId,
      content,
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/v1/widget/messages
router.get("/messages", async (req, res) => {
  try {
    const { conversationId, organizationId } = req.query;

    if (!conversationId || !organizationId) {
      return res.status(400).json({ error: "conversationId and organizationId are required" });
    }

    const msgs = await db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversationId as string),
          eq(conversationMessages.organizationId, organizationId as string)
        )
      )
      .orderBy(conversationMessages.createdAt);

    return res.json(msgs);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
