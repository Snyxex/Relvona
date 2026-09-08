import crypto from "crypto";
import { db } from "../db/index.js";
import { conversations, tickets, knowledgeSources, documentChunks, conversationMessages, analyticsEvents, conversationHandoffs, messageFeedback } from "../db/schema.js";
import { knowledgeGaps } from "../db/supportAnalyticsSchema.js";
import { eq, and, sql, desc, count, gte } from "drizzle-orm";
import { PiiRedactionService } from "./piiRedactionService.js";

const GAP_STATUSES = new Set(["open", "acknowledged", "resolved", "ignored"]);

function normalizeGapText(text: string, max: number): string {
  return PiiRedactionService.redact(text.replace(/\s+/g, " ").trim().slice(0, max)).text;
}

function gapFingerprint(topic: string, summary: string): string {
  const normalized = `${topic}|${summary}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 600);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export class AnalyticsService {
  static async getOverviewMetrics(organizationId: string) {
    const [totalConvResult] = await db.select({ count: count() }).from(conversations).where(eq(conversations.organizationId, organizationId));
    const totalConversations = Number(totalConvResult?.count || 0);

    const stateBreakdown = await db.select({ state: conversations.state, count: count() }).from(conversations)
      .where(eq(conversations.organizationId, organizationId)).groupBy(conversations.state);
    const statesMap: Record<string, number> = {};
    stateBreakdown.forEach((row) => { statesMap[row.state] = Number(row.count); });

    const [aiResolutionEvents] = await db.select({ count: sql<number>`count(distinct ${analyticsEvents.metadata}->>'conversationId')` }).from(analyticsEvents)
      .where(and(eq(analyticsEvents.organizationId, organizationId), eq(analyticsEvents.eventType, "ai_resolved")));
    const aiResolved = Number(aiResolutionEvents?.count || 0);
    const resolvedConversations = statesMap["RESOLVED"] || 0;
    const handoffs = (statesMap["WAITING_FOR_AGENT"] || 0) + (statesMap["AGENT_ACTIVE"] || 0);
    const resolutionRate = totalConversations > 0 ? parseFloat(((resolvedConversations / totalConversations) * 100).toFixed(1)) : 0;

    const [openTicketsResult] = await db.select({ count: count() }).from(tickets)
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.status, "open")));
    const openTickets = Number(openTicketsResult?.count || 0);

    const [sourcesResult] = await db.select({ count: count() }).from(knowledgeSources).where(eq(knowledgeSources.organizationId, organizationId));
    const [chunksResult] = await db.select({ count: count() }).from(documentChunks).where(eq(documentChunks.organizationId, organizationId));

    const langBreakdown = await db.select({ lang: conversations.detectedLanguage, count: count() }).from(conversations)
      .where(eq(conversations.organizationId, organizationId)).groupBy(conversations.detectedLanguage);

    const recentHandoffs = await db.select({ id: conversationMessages.id, content: conversationMessages.content, createdAt: conversationMessages.createdAt })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .where(and(eq(conversationMessages.organizationId, organizationId), eq(conversationMessages.senderType, "customer"), eq(conversations.state, "WAITING_FOR_AGENT")))
      .orderBy(desc(conversationMessages.createdAt)).limit(5);

    const [gapStats] = await db.select({ open: sql<number>`count(*) filter (where ${knowledgeGaps.status} in ('open','acknowledged'))::int` })
      .from(knowledgeGaps).where(eq(knowledgeGaps.organizationId, organizationId));

    return {
      totalConversations,
      aiResolved,
      resolvedConversations,
      handoffs,
      resolutionRate,
      openTickets,
      openKnowledgeGaps: Number(gapStats?.open || 0),
      totalKnowledgeSources: Number(sourcesResult?.count || 0),
      totalDocumentChunks: Number(chunksResult?.count || 0),
      stateBreakdown: {
        AI_ACTIVE: statesMap["AI_ACTIVE"] || 0,
        WAITING_FOR_AGENT: statesMap["WAITING_FOR_AGENT"] || 0,
        AGENT_ACTIVE: statesMap["AGENT_ACTIVE"] || 0,
        RESOLVED: statesMap["RESOLVED"] || 0,
      },
      languageBreakdown: langBreakdown.map((l) => ({ language: l.lang, count: Number(l.count) })),
      unansweredQuestions: recentHandoffs.map((q) => ({ id: q.id, question: q.content, timestamp: q.createdAt })),
    };
  }

  static async getSupportMetrics(organizationId: string, days = 30) {
    const safeDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    const from = new Date(Date.now() - safeDays * 86_400_000);

    const [conversationStats] = await db.select({
      total: sql<number>`count(*)::int`,
      resolved: sql<number>`count(*) filter (where ${conversations.state} = 'RESOLVED')::int`,
      waitingForAgent: sql<number>`count(*) filter (where ${conversations.state} = 'WAITING_FOR_AGENT')::int`,
      agentActive: sql<number>`count(*) filter (where ${conversations.state} = 'AGENT_ACTIVE')::int`,
    }).from(conversations).where(and(eq(conversations.organizationId, organizationId), gte(conversations.createdAt, from)));

    const [handoffStats] = await db.select({ total: sql<number>`count(*)::int` }).from(conversationHandoffs)
      .where(and(eq(conversationHandoffs.organizationId, organizationId), gte(conversationHandoffs.createdAt, from)));

    const [ticketStats] = await db.select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${tickets.status} in ('open','pending','in_progress'))::int`,
      resolved: sql<number>`count(*) filter (where ${tickets.status} in ('resolved','closed'))::int`,
    }).from(tickets).where(and(eq(tickets.organizationId, organizationId), gte(tickets.createdAt, from)));

    const [feedbackStats] = await db.select({
      positive: sql<number>`count(*) filter (where ${messageFeedback.rating} = 1)::int`,
      negative: sql<number>`count(*) filter (where ${messageFeedback.rating} = -1)::int`,
    }).from(messageFeedback).where(and(eq(messageFeedback.organizationId, organizationId), gte(messageFeedback.createdAt, from)));

    const [gapStats] = await db.select({
      open: sql<number>`count(*) filter (where ${knowledgeGaps.status} in ('open','acknowledged'))::int`,
      occurrences: sql<number>`coalesce(sum(${knowledgeGaps.occurrences}) filter (where ${knowledgeGaps.status} in ('open','acknowledged')), 0)::int`,
    }).from(knowledgeGaps).where(eq(knowledgeGaps.organizationId, organizationId));

    const total = Number(conversationStats?.total || 0);
    const resolved = Number(conversationStats?.resolved || 0);
    const handoffCount = Number(handoffStats?.total || 0);
    const positive = Number(feedbackStats?.positive || 0);
    const negative = Number(feedbackStats?.negative || 0);
    const feedbackTotal = positive + negative;

    return {
      range: { days: safeDays, from: from.toISOString(), to: new Date().toISOString() },
      conversations: { total, resolved, waitingForAgent: Number(conversationStats?.waitingForAgent || 0), agentActive: Number(conversationStats?.agentActive || 0), resolutionRate: total ? resolved / total : 0 },
      handoffs: { total: handoffCount, rate: total ? handoffCount / total : 0 },
      tickets: { total: Number(ticketStats?.total || 0), open: Number(ticketStats?.open || 0), resolved: Number(ticketStats?.resolved || 0) },
      feedback: { positive, negative, satisfactionRate: feedbackTotal ? positive / feedbackTotal : null },
      knowledgeGaps: { open: Number(gapStats?.open || 0), occurrences: Number(gapStats?.occurrences || 0) },
    };
  }

  static async listKnowledgeGaps(organizationId: string, status?: string, limit = 100) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 250);
    return db.select().from(knowledgeGaps).where(and(
      eq(knowledgeGaps.organizationId, organizationId),
      status && GAP_STATUSES.has(status) ? eq(knowledgeGaps.status, status) : undefined,
    )).orderBy(desc(knowledgeGaps.occurrences), desc(knowledgeGaps.lastSeenAt)).limit(safeLimit);
  }

  static async recordKnowledgeGap(data: { organizationId: string; topic: string; summary: string; sourceConversationId?: string; metadata?: Record<string, unknown> }) {
    const topic = normalizeGapText(data.topic, 120);
    const summary = normalizeGapText(data.summary, 700);
    if (topic.length < 3 || summary.length < 8) throw new Error("Knowledge gap requires a topic and summary");

    if (data.sourceConversationId) {
      const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.organizationId, data.organizationId), eq(conversations.id, data.sourceConversationId))).limit(1);
      if (!conversation) throw new Error("Conversation not found");
    }

    const fingerprint = gapFingerprint(topic, summary);
    const now = new Date();
    const [gap] = await db.insert(knowledgeGaps).values({ organizationId: data.organizationId, fingerprint, topic, summary, sourceConversationId: data.sourceConversationId, metadata: data.metadata || {}, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({ target: [knowledgeGaps.organizationId, knowledgeGaps.fingerprint], set: { occurrences: sql`${knowledgeGaps.occurrences} + 1`, lastSeenAt: now, updatedAt: now, sourceConversationId: data.sourceConversationId } }).returning();
    return gap;
  }

  static async updateKnowledgeGapStatus(organizationId: string, id: string, status: string) {
    if (!GAP_STATUSES.has(status)) throw new Error("Invalid knowledge gap status");
    const now = new Date();
    const [updated] = await db.update(knowledgeGaps).set({ status, resolvedAt: status === "resolved" ? now : null, updatedAt: now })
      .where(and(eq(knowledgeGaps.organizationId, organizationId), eq(knowledgeGaps.id, id))).returning();
    if (!updated) throw new Error("Knowledge gap not found");
    return updated;
  }
}
