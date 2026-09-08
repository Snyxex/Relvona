import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { analyticsEvents, conversationMessages, conversations, organizationSettings } from "../db/schema.js";
import { ConversationSchedulingService } from "./conversationSchedulingService.js";
import { domainEventBus } from "./domainEventBus.js";
import { PiiRedactionService } from "./piiRedactionService.js";
import { TenantQuotaService } from "./tenantQuotaService.js";

export class SchedulingConversationBridgeService {
  static async processIfHandled(data: { organizationId: string; conversationId: string; content: string }) {
    const [conversation] = await db.select().from(conversations).where(and(eq(conversations.organizationId, data.organizationId), eq(conversations.id, data.conversationId))).limit(1);
    if (!conversation || !conversation.customerId || !conversation.assistantId) return undefined;
    if (!["AI_ACTIVE", "NEW"].includes(conversation.state)) return undefined;
    if (!await ConversationSchedulingService.canHandle(data.organizationId, data.conversationId, data.content)) return undefined;

    const [settings] = await db.select({ widgetRequestsPerMinute: organizationSettings.widgetRequestsPerMinute }).from(organizationSettings).where(eq(organizationSettings.organizationId, data.organizationId)).limit(1);
    await TenantQuotaService.consumeWidgetRequest(data.organizationId, settings?.widgetRequestsPerMinute ?? 120);
    await TenantQuotaService.consumeWidgetEndUserRequest(data.organizationId, conversation.customerId, settings?.widgetRequestsPerMinute ?? 120);

    const redacted = PiiRedactionService.redact(data.content);
    if (redacted.detected.length) await db.insert(analyticsEvents).values({ organizationId: data.organizationId, eventType: "pii_redacted", metadata: { conversationId: conversation.id, types: redacted.detected } });

    const [customerMessage] = await db.insert(conversationMessages).values({ conversationId: conversation.id, organizationId: data.organizationId, senderType: "customer", senderId: conversation.customerId, content: redacted.text }).returning();
    await domainEventBus.emit({ type: "message.created", organizationId: data.organizationId, conversationId: conversation.id, payload: customerMessage });

    const scheduling = await ConversationSchedulingService.handle({ organizationId: data.organizationId, conversationId: conversation.id, customerId: conversation.customerId, text: redacted.text });
    if (!scheduling.handled) return undefined;

    const [aiResponse] = await db.insert(conversationMessages).values({ conversationId: conversation.id, organizationId: data.organizationId, senderType: "ai", senderId: conversation.assistantId, senderName: "AI Assistant", content: scheduling.reply || "" }).returning();
    await domainEventBus.emit({ type: "message.created", organizationId: data.organizationId, conversationId: conversation.id, payload: aiResponse });
    await db.update(conversations).set({ updatedAt: new Date() }).where(and(eq(conversations.organizationId, data.organizationId), eq(conversations.id, conversation.id)));
    await db.insert(analyticsEvents).values({ organizationId: data.organizationId, eventType: "scheduling_conversation_handled", metadata: { conversationId: conversation.id, actionExecutionId: scheduling.actionExecutionId } });

    return { customerMessage, aiResponse, state: conversation.state, handoffTriggered: false, actionExecutionId: scheduling.actionExecutionId };
  }
}
