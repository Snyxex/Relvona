import { db } from "../db/index.js";
import { conversations, conversationMessages, customers, tickets, analyticsEvents, assistants } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { RAGService } from "./ragService.js";
import { TenantQuotaService, TenantQuotaExceededError } from "./tenantQuotaService.js";
import { organizationSettings } from "../db/schema.js";
import { PiiRedactionService } from "./piiRedactionService.js";
import { TicketService } from "./ticketService.js";

export class ConversationService {
  static async translateMessage(data: { organizationId: string; assistantId: string; content: string; targetLanguage: string }) {
    return RAGService.translateForAgent({ ...data, text: data.content });
  }
  private static compactHistory(messages: { senderType: string; content: string }[]): string {
    return messages
      .map((message) => `${message.senderType === "customer" ? "Customer" : "Support"}: ${RAGService.normalizeCustomerInput(message.content).slice(0, 220)}`)
      .join("\n")
      .slice(-1_500);
  }
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
    onToken?: (token: string) => void | Promise<void>;
  }) {
    // 1. Fetch Conversation
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, data.organizationId))).limit(1);
    if (!conv) throw new Error("Conversation not found");
    const [settings] = await db.select({ widgetRequestsPerMinute: organizationSettings.widgetRequestsPerMinute }).from(organizationSettings).where(eq(organizationSettings.organizationId, data.organizationId)).limit(1);
    await TenantQuotaService.consumeWidgetRequest(data.organizationId, settings?.widgetRequestsPerMinute ?? 120);
    await TenantQuotaService.consumeWidgetEndUserRequest(data.organizationId, conv.customerId, settings?.widgetRequestsPerMinute ?? 120);

    // 2. Redact accidental PII before persistence, embeddings, and provider calls.
    const redactedInput = PiiRedactionService.redact(data.content);
    if (redactedInput.detected.length) await db.insert(analyticsEvents).values({ organizationId: data.organizationId, eventType: "pii_redacted", metadata: { conversationId: conv.id, types: redactedInput.detected } });

    // 3. Save Customer Message
    const [custMsg] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conv.id,
        organizationId: data.organizationId,
        senderType: "customer",
        senderId: conv.customerId,
        content: redactedInput.text,
      })
      .returning();

    // If conversation is already handled by human agent (AGENT_ACTIVE), do not auto-respond with AI
    if (conv.state === "AGENT_ACTIVE") {
      // Generate suggested reply for agent
      const suggested = await RAGService.generateSuggestedReply({
        organizationId: data.organizationId,
        customerQuery: redactedInput.text,
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
      .limit(12);

    const chronologicalHistory = historyMsgs.reverse();
    // The current message was saved immediately before this query and is appended by
    // RAGService itself, so do not pay to send it twice.
    const historyBeforeCurrentMessage = chronologicalHistory.slice(0, -1);
    const recentHistory = historyBeforeCurrentMessage.slice(-4);
    const formattedHistory = recentHistory.map((m) => ({
      role: m.senderType,
      content: m.content,
    }));
    const rollingSummary = historyBeforeCurrentMessage.length > 4
      ? this.compactHistory(historyBeforeCurrentMessage.slice(0, -4))
      : conv.summary;

    // Execute RAG Engine
    let ragResult;
    try {
      ragResult = await RAGService.generateRAGAnswer({
        organizationId: data.organizationId,
        assistantId: conv.assistantId!,
      customerQuery: redactedInput.text,
        // The opening message determines the customer-facing language. Do not
        // switch languages mid-conversation just because a later message has
        // fewer detectable language markers.
        responseLanguage: historyBeforeCurrentMessage.some((message) => message.senderType === "customer") ? conv.detectedLanguage : undefined,
        conversationHistory: formattedHistory,
        conversationSummary: rollingSummary,
        onToken: data.onToken,
      });
    } catch (error) {
      // Spend is enforced before provider calls. When the daily budget is spent,
      // preserve the request and queue a human handoff instead of silently failing.
      if (!(error instanceof TenantQuotaExceededError) || error.message === "Widget request quota exceeded") throw error;
      await db.update(conversations).set({ state: "WAITING_FOR_AGENT", updatedAt: new Date() }).where(eq(conversations.id, conv.id));
      const ticket = await TicketService.createTicket({ organizationId: data.organizationId, customerId: conv.customerId, conversationId: conv.id, subject: "AI budget exhausted - customer needs assistance", description: "Created automatically because the tenant's daily AI token budget is exhausted.", priority: "normal", tags: ["budget-fallback"] });
      await db.insert(analyticsEvents).values({ organizationId: data.organizationId, eventType: "budget_handoff_requested", metadata: { conversationId: conv.id, ticketId: ticket.id } });
      return { customerMessage: custMsg, aiResponse: null, state: "WAITING_FOR_AGENT", handoffTriggered: true, budgetFallback: true, fallbackMessage: "Unser KI-Support ist für heute ausgeschöpft. Wir haben Ihre Anfrage an unser Support-Team weitergegeben." };
    }

    const sentiment = RAGService.analyzeSentiment(redactedInput.text);

    // Update conversation metadata
    await db
      .update(conversations)
      .set({
        detectedLanguage: ragResult.detectedLanguage,
        sentiment,
        summary: rollingSummary,
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
