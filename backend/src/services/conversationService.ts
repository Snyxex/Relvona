import { db } from "../db/index.js";
import { conversations, conversationMessages, customers, tickets, analyticsEvents, assistants } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { RAGService } from "./ragService.js";

export class ConversationService {
  // Find or Create Customer
  static async getOrCreateCustomer(data: {
    organizationId: string;
    email?: string;
    name?: string;
    externalId?: string;
  }) {
    if (data.email) {
      const [existing] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.organizationId, data.organizationId), eq(customers.email, data.email.toLowerCase())))
        .limit(1);

      if (existing) return existing;
    }

    const [newCustomer] = await db
      .insert(customers)
      .values({
        organizationId: data.organizationId,
        email: data.email ? data.email.toLowerCase() : `visitor_${Date.now()}@anonymous.com`,
        name: data.name || "Website Visitor",
        externalId: data.externalId,
      })
      .returning();

    return newCustomer;
  }

  // Initiate or Get Active Conversation Session
  static async getOrCreateConversation(data: {
    organizationId: string;
    assistantId?: string;
    customerId: string;
  }) {
    // Check if there is an active conversation (not resolved)
    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, data.organizationId),
          eq(conversations.customerId, data.customerId)
        )
      )
      .orderBy(desc(conversations.createdAt))
      .limit(1);

    if (existing && existing.state !== "RESOLVED") {
      return existing;
    }

    // Resolve assistant ID if not provided
    let targetAssistantId = data.assistantId;
    if (!targetAssistantId) {
      const [defaultAssistant] = await db
        .select()
        .from(assistants)
        .where(eq(assistants.organizationId, data.organizationId))
        .limit(1);

      if (defaultAssistant) targetAssistantId = defaultAssistant.id;
    }

    const [newConv] = await db
      .insert(conversations)
      .values({
        organizationId: data.organizationId,
        assistantId: targetAssistantId,
        customerId: data.customerId,
        state: "AI_ACTIVE",
      })
      .returning();

    // Log Analytics Event
    await db.insert(analyticsEvents).values({
      organizationId: data.organizationId,
      eventType: "conversation_created",
      metadata: { conversationId: newConv.id },
    });

    return newConv;
  }

  // Handle Customer Message Entry (RAG & Handoff Workflow)
  static async processCustomerMessage(data: {
    organizationId: string;
    conversationId: string;
    content: string;
  }) {
    // 1. Fetch Conversation
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, data.conversationId)).limit(1);
    if (!conv) throw new Error("Conversation not found");

    // 2. Save Customer Message
    const [custMsg] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conv.id,
        organizationId: data.organizationId,
        senderType: "customer",
        senderId: conv.customerId,
        content: data.content,
      })
      .returning();

    // If conversation is already handled by human agent (AGENT_ACTIVE), do not auto-respond with AI
    if (conv.state === "AGENT_ACTIVE") {
      // Generate suggested reply for agent
      const suggested = await RAGService.generateSuggestedReply({
        organizationId: data.organizationId,
        customerQuery: data.content,
        conversationHistory: [],
      });

      return {
        customerMessage: custMsg,
        state: conv.state,
        aiResponse: null,
        suggestedReplyForAgent: suggested,
      };
    }

    // Fetch conversation message history
    const historyMsgs = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conv.id))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(6);

    const formattedHistory = historyMsgs.reverse().map((m) => ({
      role: m.senderType,
      content: m.content,
    }));

    // Execute RAG Engine
    const ragResult = await RAGService.generateRAGAnswer({
      organizationId: data.organizationId,
      assistantId: conv.assistantId!,
      customerQuery: data.content,
      conversationHistory: formattedHistory,
    });

    const sentiment = RAGService.analyzeSentiment(data.content);

    // Update conversation metadata
    await db
      .update(conversations)
      .set({
        detectedLanguage: ragResult.detectedLanguage,
        sentiment,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id));

    // Save AI Response Message
    const [aiMsg] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conv.id,
        organizationId: data.organizationId,
        senderType: "ai",
        senderId: conv.assistantId,
        senderName: "AI Assistant",
        content: ragResult.answer,
        confidenceScore: ragResult.confidenceScore,
        retrievedChunkIds: ragResult.retrievedChunkIds,
      })
      .returning();

    // Check if handoff was triggered
    let newState = conv.state;
    if (ragResult.handoffTriggered) {
      newState = "WAITING_FOR_AGENT";
      await db
        .update(conversations)
        .set({ state: "WAITING_FOR_AGENT", updatedAt: new Date() })
        .where(eq(conversations.id, conv.id));

      await db.insert(analyticsEvents).values({
        organizationId: data.organizationId,
        eventType: "handoff_requested",
        metadata: { conversationId: conv.id },
      });
    } else {
      await db.insert(analyticsEvents).values({
        organizationId: data.organizationId,
        eventType: "ai_resolved",
        metadata: { conversationId: conv.id },
      });
    }

    return {
      customerMessage: custMsg,
      aiResponse: aiMsg,
      state: newState,
      handoffTriggered: ragResult.handoffTriggered,
      sourcesUsed: ragResult.sourcesUsed,
    };
  }

  // Agent Sends Message
  static async sendAgentMessage(data: {
    organizationId: string;
    conversationId: string;
    agentId: string;
    agentName: string;
    content: string;
  }) {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, data.conversationId)).limit(1);
    if (!conv) throw new Error("Conversation not found");

    // Transition state to AGENT_ACTIVE if coming from WAITING_FOR_AGENT
    if (conv.state !== "AGENT_ACTIVE") {
      await db
        .update(conversations)
        .set({
          state: "AGENT_ACTIVE",
          assignedAgentId: data.agentId,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conv.id));
    }

    const [agentMsg] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conv.id,
        organizationId: data.organizationId,
        senderType: "agent",
        senderId: data.agentId,
        senderName: data.agentName,
        content: data.content,
      })
      .returning();

    return agentMsg;
  }

  // Resolve Conversation
  static async resolveConversation(organizationId: string, conversationId: string) {
    const [updated] = await db
      .update(conversations)
      .set({ state: "RESOLVED", updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
      .returning();

    await db.insert(analyticsEvents).values({
      organizationId,
      eventType: "conversation_resolved",
      metadata: { conversationId },
    });

    return updated;
  }
}
