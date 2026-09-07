import { db } from "../db/index.js";
import { conversations, conversationMessages, customers, tickets, analyticsEvents, assistants } from "../db/schema.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { RAGService } from "./ragService.js";
import { TenantQuotaService, TenantQuotaExceededError } from "./tenantQuotaService.js";
import { organizationSettings } from "../db/schema.js";
import { PiiRedactionService } from "./piiRedactionService.js";
import { TicketService } from "./ticketService.js";
import { domainEventBus } from "./domainEventBus.js";
import { ConversationWorkflowService } from "./conversationWorkflowService.js";
import { VisitorIdentityService } from "./visitorIdentityService.js";
import { VisitorMemoryCaptureService } from "./visitorMemoryCaptureService.js";

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
        email: data.email ? data.email.toLowerCase() : null,
        name: data.name || "Website Visitor",
        externalId: data.externalId,
      })
      .returning();

    return newCustomer;
  }

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

    if (existing && existing.state !== "RESOLVED" && existing.state !== "CLOSED") {
      return existing;
    }

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

    await db.insert(analyticsEvents).values({
      organizationId: data.organizationId,
      eventType: "conversation_created",
      metadata: { conversationId: newConv.id },
    });

    return newConv;
  }

  static async processCustomerMessage(data: {
    organizationId: string;
    conversationId: string;
    content: string;
    onToken?: (token: string) => void | Promise<void>;
  }) {
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, data.organizationId))).limit(1);
    if (!conv) throw new Error("Conversation not found");
    if (conv.state === "CLOSED" || conv.state === "RESOLVED") {
      await db.update(conversations).set({ state: conv.state === "CLOSED" ? "WAITING_FOR_AGENT" : "AGENT_ACTIVE", updatedAt: new Date() }).where(and(eq(conversations.id, conv.id), eq(conversations.organizationId, data.organizationId)));
    }
    const [settings] = await db.select({ widgetRequestsPerMinute: organizationSettings.widgetRequestsPerMinute }).from(organizationSettings).where(eq(organizationSettings.organizationId, data.organizationId)).limit(1);
    await TenantQuotaService.consumeWidgetRequest(data.organizationId, settings?.widgetRequestsPerMinute ?? 120);
    await TenantQuotaService.consumeWidgetEndUserRequest(data.organizationId, conv.customerId, settings?.widgetRequestsPerMinute ?? 120);

    const redactedInput = PiiRedactionService.redact(data.content);
    if (redactedInput.detected.length) await db.insert(analyticsEvents).values({ organizationId: data.organizationId, eventType: "pii_redacted", metadata: { conversationId: conv.id, types: redactedInput.detected } });

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
    if (["AGENT_ACTIVE", "WAITING_FOR_AGENT", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"].includes(conv.state)) {
      await db.update(conversations).set({ updatedAt: new Date() })
        .where(and(eq(conversations.id, conv.id), eq(conversations.organizationId, data.organizationId)));
      return {
        customerMessage: custMsg,
        state: conv.state,
        aiResponse: null,
      };
    }

    const historyMsgs = await db
      .select()
      .from(conversationMessages)
      .where(and(eq(conversationMessages.conversationId, conv.id), eq(conversationMessages.organizationId, data.organizationId)))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(12);

    const chronologicalHistory = historyMsgs.reverse();
    const historyBeforeCurrentMessage = chronologicalHistory.filter((message) => message.id !== custMsg.id);
    const recentHistory = historyBeforeCurrentMessage.slice(-4);
    const formattedHistory = recentHistory.map((m) => ({
      role: m.senderType,
      content: m.content,
    }));
    const rollingSummary = historyBeforeCurrentMessage.length > 4
      ? this.compactHistory(historyBeforeCurrentMessage.slice(0, -4))
      : conv.summary;

    const visitorMemories = await VisitorIdentityService.memoriesForConversation(data.organizationId, conv.id, 8);
    const visitorMemoryContext = visitorMemories.length
      ? `Previous support context for this pseudonymous visitor:\n${visitorMemories
          .map((memory) => `- [${memory.type}] ${memory.summary.slice(0, 320)}`)
          .join("\n")}`.slice(0, 2_200)
      : undefined;
    const aiContextSummary = [rollingSummary, visitorMemoryContext].filter(Boolean).join("\n\n") || undefined;
    if (visitorMemories.length) {
      await db.insert(analyticsEvents).values({
        organizationId: data.organizationId,
        eventType: "visitor_memory_context_used",
        metadata: { conversationId: conv.id, memoryCount: visitorMemories.length },
      });
    }

    let ragResult;
    try {
      ragResult = await RAGService.generateRAGAnswer({
        organizationId: data.organizationId,
        assistantId: conv.assistantId!,
        customerQuery: redactedInput.text,
        responseLanguage: historyBeforeCurrentMessage.some((message) => message.senderType === "customer") ? conv.detectedLanguage : undefined,
        conversationHistory: formattedHistory,
        conversationSummary: aiContextSummary,
        onToken: data.onToken,
      });
    } catch (error) {
      if (error instanceof TenantQuotaExceededError) {
        if (error.message === "Widget request quota exceeded") throw error;
        await db.update(conversations).set({ state: "WAITING_FOR_AGENT", updatedAt: new Date() }).where(eq(conversations.id, conv.id));
        await ConversationWorkflowService.recordHandoff({ organizationId: data.organizationId, conversationId: conv.id, reason: "AI_BUDGET_EXHAUSTED", requestedPriority: "NORMAL" });
        const ticket = await TicketService.getOrCreateEscalationTicket({ organizationId: data.organizationId, customerId: conv.customerId, conversationId: conv.id, subject: "AI budget exhausted - customer needs assistance", description: "Created automatically because the tenant's daily AI token budget is exhausted.", priority: "normal", tags: ["budget-fallback", "needs-human-review"] });
        await db.insert(analyticsEvents).values({ organizationId: data.organizationId, eventType: "budget_handoff_requested", metadata: { conversationId: conv.id, ticketId: ticket.ticket.id, ticketNumber: ticket.ticket.ticketNumber, ticketCreated: ticket.created } });
        return { customerMessage: custMsg, aiResponse: null, state: "WAITING_FOR_AGENT", handoffTriggered: true, budgetFallback: true, fallbackMessage: "Unser KI-Support ist für heute ausgeschöpft. Wir haben Ihre Anfrage an unser Support-Team weitergegeben.", ticketId: ticket.ticket.id, ticketNumber: ticket.ticket.ticketNumber, ticketCreated: ticket.created };
      }

      await db.update(conversations).set({ state: "WAITING_FOR_AGENT", updatedAt: new Date() }).where(eq(conversations.id, conv.id));
      await ConversationWorkflowService.recordHandoff({ organizationId: data.organizationId, conversationId: conv.id, reason: "AI_PROCESSING_FAILED", requestedPriority: RAGService.analyzeSentiment(redactedInput.text) === "frustrated" ? "HIGH" : "NORMAL" });
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

    await db
      .update(conversations)
      .set({
        detectedLanguage: ragResult.detectedLanguage,
        sentiment,
        summary: rollingSummary,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id));

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
    let newState = conv.state;
    if (ragResult.handoffTriggered) {
      newState = "WAITING_FOR_AGENT";
      await db
        .update(conversations)
        .set({ state: "WAITING_FOR_AGENT", updatedAt: new Date() })
        .where(eq(conversations.id, conv.id));
      await ConversationWorkflowService.recordHandoff({ organizationId: data.organizationId, conversationId: conv.id, reason: "AI_ESCALATED", aiConfidence: ragResult.confidenceScore, lastAiAttempt: ragResult.answer.slice(0, 2_000), requestedPriority: sentiment === "frustrated" ? "HIGH" : "NORMAL" });

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

    void VisitorMemoryCaptureService.captureExchange({
      organizationId: data.organizationId,
      conversationId: conv.id,
      customerText: redactedInput.text,
      assistantText: ragResult.answer,
      handoffTriggered: ragResult.handoffTriggered,
    }).catch(() => undefined);

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

    if (conv.state === "WAITING_FOR_AGENT") {
      if (conv.assignedAgentId && conv.assignedAgentId !== data.agentId) throw new Error("Conversation is assigned to another agent");
      await ConversationWorkflowService.assign({
        organizationId: data.organizationId,
        conversationId: conv.id,
        actorUserId: data.agentId,
        assigneeId: data.agentId,
      });
    } else if (conv.state !== "AGENT_ACTIVE" || conv.assignedAgentId !== data.agentId) {
      throw new Error("Conversation is not ready for an agent reply");
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

    await ConversationWorkflowService.transition({
      organizationId: data.organizationId,
      conversationId: conv.id,
      actorUserId: data.agentId,
      target: "WAITING_FOR_CUSTOMER",
    });

    await domainEventBus.emit({ type: "message.created", organizationId: data.organizationId, conversationId: conv.id, payload: agentMsg });
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
