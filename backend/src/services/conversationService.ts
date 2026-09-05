import { db } from "../db/index.js";
import { conversations, conversationMessages, customers, tickets, analyticsEvents, assistants } from "../db/schema.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { RAGService } from "./ragService.js";
import { TenantQuotaService, TenantQuotaExceededError } from "./tenantQuotaService.js";
import { organizationSettings } from "../db/schema.js";
import { PiiRedactionService } from "./piiRedactionService.js";
import { TicketService } from "./ticketService.js";
import { domainEventBus } from "./domainEventBus.js";

export class ConversationService {
  private static ticketConfirmation(language: string, ticketNumber: number, created: boolean): string {
    if (language === "de") {
      return created
        ? `Ich konnte dieses Problem nicht zuverlässig lösen. Deshalb haben wir Ticket #${ticketNumber} für unser Support-Team erstellt.`
        : `Ihre Anfrage ist bereits in Ticket #${ticketNumber} an unser Support-Team weitergegeben.`;
    }
    if (language === "es") {
      return created
        ? `No pude resolver este problema de forma fiable. Hemos creado el ticket #${ticketNumber} para nuestro equipo de soporte.`
        : `Tu solicitud ya se ha enviado a nuestro equipo de soporte en el ticket #${ticketNumber}.`;
    }
    if (language === "fr") {
      return created
        ? `Je n'ai pas pu résoudre ce problème de manière fiable. Nous avons créé le ticket #${ticketNumber} pour notre équipe d'assistance.`
        : `Votre demande a déjà été transmise à notre équipe d'assistance dans le ticket #${ticketNumber}.`;
    }
    return created
      ? `I could not resolve this issue reliably, so we created ticket #${ticketNumber} for our support team.`
      : `Your request has already been sent to our support team in ticket #${ticketNumber}.`;
  }

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
    const [customer] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, data.customerId), eq(customers.organizationId, data.organizationId))).limit(1);
    if (!customer) throw new Error("Customer not found");
    if (data.assistantId) {
      const [assistant] = await db.select({ id: assistants.id }).from(assistants)
        .where(and(eq(assistants.id, data.assistantId), eq(assistants.organizationId, data.organizationId))).limit(1);
      if (!assistant) throw new Error("Assistant not found");
    }
    // Check if there is an active conversation (not resolved)
    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, data.organizationId),
          eq(conversations.customerId, data.customerId),
          data.assistantId ? eq(conversations.assistantId, data.assistantId) : undefined
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
    if (conv.state === "RESOLVED") throw new Error("Conversation is resolved");
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

    await domainEventBus.emit({ type: "message.created", organizationId: data.organizationId, conversationId: conv.id, payload: custMsg });
    // Human-owned and queued conversations must not auto-respond with AI.
    if (conv.state === "AGENT_ACTIVE" || conv.state === "WAITING_FOR_AGENT") {
      await db.update(conversations).set({ updatedAt: new Date() })
        .where(and(eq(conversations.id, conv.id), eq(conversations.organizationId, data.organizationId)));
      return {
        customerMessage: custMsg,
        state: conv.state,
        aiResponse: null,
      };
    }

    // Fetch conversation message history
    const historyMsgs = await db
      .select()
      .from(conversationMessages)
      .where(and(eq(conversationMessages.conversationId, conv.id), eq(conversationMessages.organizationId, data.organizationId)))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(12);

    const chronologicalHistory = historyMsgs.reverse();
    // The current message was saved immediately before this query and is appended by
    // RAGService itself, so do not pay to send it twice.
    const historyBeforeCurrentMessage = chronologicalHistory.filter((message) => message.id !== custMsg.id);
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
      if (error instanceof TenantQuotaExceededError) {
        if (error.message === "Widget request quota exceeded") throw error;
        await db.update(conversations).set({ state: "WAITING_FOR_AGENT", updatedAt: new Date() }).where(eq(conversations.id, conv.id));
        const ticket = await TicketService.getOrCreateEscalationTicket({ organizationId: data.organizationId, customerId: conv.customerId, conversationId: conv.id, subject: "AI budget exhausted - customer needs assistance", description: "Created automatically because the tenant's daily AI token budget is exhausted.", priority: "normal", tags: ["budget-fallback", "needs-human-review"] });
        await db.insert(analyticsEvents).values({ organizationId: data.organizationId, eventType: "budget_handoff_requested", metadata: { conversationId: conv.id, ticketId: ticket.ticket.id, ticketNumber: ticket.ticket.ticketNumber, ticketCreated: ticket.created } });
        return { customerMessage: custMsg, aiResponse: null, state: "WAITING_FOR_AGENT", handoffTriggered: true, budgetFallback: true, fallbackMessage: "Unser KI-Support ist für heute ausgeschöpft. Wir haben Ihre Anfrage an unser Support-Team weitergegeben.", ticketId: ticket.ticket.id, ticketNumber: ticket.ticket.ticketNumber, ticketCreated: ticket.created };
      }

      // Provider, embedding, or model failures must not discard a customer's
      // issue. Do not expose technical errors; create a durable human handoff.
      await db.update(conversations).set({ state: "WAITING_FOR_AGENT", updatedAt: new Date() }).where(eq(conversations.id, conv.id));
      const escalation = await TicketService.getOrCreateEscalationTicket({
        organizationId: data.organizationId,
        customerId: conv.customerId,
        conversationId: conv.id,
        subject: "AI processing failed - customer request open",
        description: `Created automatically because AI processing was unavailable.\n\nCustomer request:\n${redactedInput.text}`,
        priority: RAGService.analyzeSentiment(redactedInput.text) === "frustrated" ? "high" : "normal",
        tags: ["ai-processing-failure", "needs-human-review"],
      });
      const language = RAGService.detectLanguage(redactedInput.text);
      await db.insert(analyticsEvents).values({ organizationId: data.organizationId, eventType: "ai_processing_handoff_requested", metadata: { conversationId: conv.id, ticketId: escalation.ticket.id, ticketNumber: escalation.ticket.ticketNumber, ticketCreated: escalation.created } });
      return { customerMessage: custMsg, aiResponse: null, state: "WAITING_FOR_AGENT", handoffTriggered: true, fallbackMessage: this.ticketConfirmation(language, escalation.ticket.ticketNumber, escalation.created), ticketId: escalation.ticket.id, ticketNumber: escalation.ticket.ticketNumber, ticketCreated: escalation.created };
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

    // An AI handoff means the retrieved knowledge was insufficient, the user
    // explicitly requested a human, or the issue needs manual handling. Turn
    // that state into a real, deduplicated support ticket immediately.
    const escalation = ragResult.handoffTriggered
      ? await TicketService.getOrCreateEscalationTicket({
          organizationId: data.organizationId,
          customerId: conv.customerId,
          conversationId: conv.id,
          subject: "KI konnte Kundenanfrage nicht lösen",
          description: `Automatisch erstellt, weil die KI die Anfrage nicht zuverlässig lösen konnte.\n\nKundenanfrage:\n${redactedInput.text}\n\nKI-Konfidenz: ${ragResult.confidenceScore.toFixed(2)}`,
          priority: RAGService.analyzeSentiment(redactedInput.text) === "frustrated" ? "high" : "normal",
          tags: ["ai-escalation", "needs-human-review"],
        })
      : undefined;

    if (escalation) {
      ragResult.answer = this.ticketConfirmation(ragResult.detectedLanguage, escalation.ticket.ticketNumber, escalation.created);
    }

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

    await domainEventBus.emit({ type: "message.created", organizationId: data.organizationId, conversationId: conv.id, payload: aiMsg });
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
        metadata: { conversationId: conv.id, ticketId: escalation?.ticket.id, ticketNumber: escalation?.ticket.ticketNumber, ticketCreated: escalation?.created },
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
      ticketId: escalation?.ticket.id,
      ticketNumber: escalation?.ticket.ticketNumber,
      ticketCreated: escalation?.created,
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
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, data.organizationId)))
      .limit(1);
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
        .where(and(eq(conversations.id, conv.id), eq(conversations.organizationId, data.organizationId)));
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

    await domainEventBus.emit({ type: "message.created", organizationId: data.organizationId, conversationId: conv.id, payload: agentMsg });
    // Claim the open ticket that caused this handoff as soon as an agent
    // actually responds. This keeps the ticket queue aligned with the chat.
    const claimedTickets = await db
      .update(tickets)
      .set({
        status: "in_progress",
        assignedAgentId: data.agentId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tickets.organizationId, data.organizationId),
          eq(tickets.conversationId, conv.id),
          inArray(tickets.status, ["open", "pending", "in_progress"])
        )
      )
      .returning({ id: tickets.id, ticketNumber: tickets.ticketNumber });

    if (claimedTickets.length) {
      await db.insert(analyticsEvents).values({
        organizationId: data.organizationId,
        eventType: "ticket_claimed_from_conversation",
        metadata: { conversationId: conv.id, ticketId: claimedTickets[0].id, ticketNumber: claimedTickets[0].ticketNumber, agentId: data.agentId },
      });
    }

    return agentMsg;
  }

  // Resolve Conversation
  static async resolveConversation(organizationId: string, conversationId: string) {
    const [updated] = await db
      .update(conversations)
      .set({ state: "RESOLVED", updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
      .returning();

    if (!updated) throw new Error("Conversation not found");

    await db.insert(analyticsEvents).values({
      organizationId,
      eventType: "conversation_resolved",
      metadata: { conversationId },
    });

    return updated;
  }
}
