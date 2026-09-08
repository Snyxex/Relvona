import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { conversationMessages, messageFeedback } from "../db/schema.js";
import { AnalyticsService } from "./analyticsService.js";

export class KnowledgeGapDiscoveryService {
  static async discoverFromNegativeFeedback(organizationId: string, limit = 100) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 250);
    const feedbackRows = await db.select({
      conversationId: messageFeedback.conversationId,
      messageId: messageFeedback.messageId,
      reason: messageFeedback.reason,
      feedbackCreatedAt: messageFeedback.createdAt,
      aiCreatedAt: conversationMessages.createdAt,
    }).from(messageFeedback)
      .innerJoin(conversationMessages, eq(messageFeedback.messageId, conversationMessages.id))
      .where(and(
        eq(messageFeedback.organizationId, organizationId),
        eq(messageFeedback.rating, -1),
        eq(conversationMessages.organizationId, organizationId),
        eq(conversationMessages.senderType, "ai"),
      ))
      .orderBy(desc(messageFeedback.createdAt))
      .limit(safeLimit);

    let processed = 0;
    for (const feedback of feedbackRows) {
      const [question] = await db.select({ content: conversationMessages.content })
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.organizationId, organizationId),
          eq(conversationMessages.conversationId, feedback.conversationId),
          eq(conversationMessages.senderType, "customer"),
          lte(conversationMessages.createdAt, feedback.aiCreatedAt),
        ))
        .orderBy(desc(conversationMessages.createdAt))
        .limit(1);
      if (!question?.content) continue;

      await AnalyticsService.recordKnowledgeGap({
        organizationId,
        topic: "Negative AI feedback",
        summary: `${question.content}${feedback.reason ? ` | Feedback: ${feedback.reason}` : ""}`,
        sourceConversationId: feedback.conversationId,
        metadata: { source: "negative_ai_feedback", messageId: feedback.messageId },
      });
      processed += 1;
    }

    return { scanned: feedbackRows.length, processed };
  }
}
