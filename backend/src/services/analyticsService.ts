import { db } from "../db/index.js";
import { conversations, tickets, knowledgeSources, documentChunks, conversationMessages, analyticsEvents } from "../db/schema.js";
import { eq, and, sql, desc, count } from "drizzle-orm";

export class AnalyticsService {
  static async getOverviewMetrics(organizationId: string) {
    // 1. Total Conversations
    const [totalConvResult] = await db
      .select({ count: count() })
      .from(conversations)
      .where(eq(conversations.organizationId, organizationId));

    const totalConversations = Number(totalConvResult?.count || 0);

    // 2. State breakdown
    const stateBreakdown = await db
      .select({
        state: conversations.state,
        count: count(),
      })
      .from(conversations)
      .where(eq(conversations.organizationId, organizationId))
      .groupBy(conversations.state);

    const statesMap: Record<string, number> = {};
    stateBreakdown.forEach((row) => {
      statesMap[row.state] = Number(row.count);
    });

    const [aiResolutionEvents] = await db.select({ count: sql<number>`count(distinct ${analyticsEvents.metadata}->>'conversationId')` }).from(analyticsEvents)
      .where(and(eq(analyticsEvents.organizationId, organizationId), eq(analyticsEvents.eventType, "ai_resolved")));
    const aiResolved = Number(aiResolutionEvents?.count || 0);
    const resolvedConversations = statesMap["RESOLVED"] || 0;
    const handoffs = (statesMap["WAITING_FOR_AGENT"] || 0) + (statesMap["AGENT_ACTIVE"] || 0);
    const resolutionRate = totalConversations > 0 ? parseFloat(((resolvedConversations / totalConversations) * 100).toFixed(1)) : 0;

    // 3. Open Tickets
    const [openTicketsResult] = await db
      .select({ count: count() })
      .from(tickets)
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.status, "open")));

    const openTickets = Number(openTicketsResult?.count || 0);

    // 4. Knowledge Sources & Chunks count
    const [sourcesResult] = await db
      .select({ count: count() })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.organizationId, organizationId));

    const [chunksResult] = await db
      .select({ count: count() })
      .from(documentChunks)
      .where(eq(documentChunks.organizationId, organizationId));

    // 5. Language Breakdown
    const langBreakdown = await db
      .select({
        lang: conversations.detectedLanguage,
        count: count(),
      })
      .from(conversations)
      .where(eq(conversations.organizationId, organizationId))
      .groupBy(conversations.detectedLanguage);

    // 6. Recent Unanswered / Handoff Questions
    const recentHandoffs = await db
      .select({
        id: conversationMessages.id,
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .where(
        and(
          eq(conversationMessages.organizationId, organizationId),
          eq(conversationMessages.senderType, "customer"),
          eq(conversations.state, "WAITING_FOR_AGENT")
        )
      )
      .orderBy(desc(conversationMessages.createdAt))
      .limit(5);

    return {
      totalConversations,
      aiResolved,
      resolvedConversations,
      handoffs,
      resolutionRate,
      openTickets,
      totalKnowledgeSources: Number(sourcesResult?.count || 0),
      totalDocumentChunks: Number(chunksResult?.count || 0),
      stateBreakdown: {
        AI_ACTIVE: statesMap["AI_ACTIVE"] || 0,
        WAITING_FOR_AGENT: statesMap["WAITING_FOR_AGENT"] || 0,
        AGENT_ACTIVE: statesMap["AGENT_ACTIVE"] || 0,
        RESOLVED: statesMap["RESOLVED"] || 0,
      },
      languageBreakdown: langBreakdown.map((l) => ({
        language: l.lang,
        count: Number(l.count),
      })),
      unansweredQuestions: recentHandoffs.map((q) => ({
        id: q.id,
        question: q.content,
        timestamp: q.createdAt,
      })),
    };
  }
}
