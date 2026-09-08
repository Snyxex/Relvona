import crypto from "crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { knowledgeGaps } from "../db/supportAnalyticsSchema.js";
import { conversationHandoffs, conversations, messageFeedback, tickets } from "../db/schema.js";
import { PiiRedactionService } from "./piiRedactionService.js";

const GAP_STATUSES = new Set(["open", "acknowledged", "resolved", "ignored"]);

function normalize(text: string, max: number): string {
  return PiiRedactionService.redact(text.replace(/\s+/g, " ").trim().slice(0, max)).text;
}

function fingerprint(topic: string, summary: string): string {
  const normalized = `${topic}|${summary}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 600);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export class SupportAnalyticsService {
  static async overview(organizationId: string, days = 30) {
    const safeDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    const from = new Date(Date.now() - safeDays * 86_400_000);

    const [conversationStats] = await db.select({
      total: sql<number>`count(*)::int`,
      resolved: sql<number>`count(*) filter (where ${conversations.state} = 'RESOLVED')::int`,
      waitingForAgent: sql<number>`count(*) filter (where ${conversations.state} = 'WAITING_FOR_AGENT')::int`,
      agentActive: sql<number>`count(*) filter (where ${conversations.state} = 'AGENT_ACTIVE')::int`,
    }).from(conversations).where(and(eq(conversations.organizationId, organizationId), gte(conversations.createdAt, from)));

    const [handoffStats] = await db.select({ total: sql<number>`count(*)::int` })
      .from(conversationHandoffs)
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

    const total = conversationStats?.total || 0;
    const resolved = conversationStats?.resolved || 0;
    const handoffs = handoffStats?.total || 0;
    const positive = feedbackStats?.positive || 0;
    const negative = feedbackStats?.negative || 0;
    const feedbackTotal = positive + negative;

    return {
      range: { days: safeDays, from: from.toISOString(), to: new Date().toISOString() },
      conversations: {
        total,
        resolved,
        waitingForAgent: conversationStats?.waitingForAgent || 0,
        agentActive: conversationStats?.agentActive || 0,
        resolutionRate: total ? resolved / total : 0,
      },
      handoffs: { total: handoffs, rate: total ? handoffs / total : 0 },
      tickets: ticketStats || { total: 0, open: 0, resolved: 0 },
      feedback: {
        positive,
        negative,
        satisfactionRate: feedbackTotal ? positive / feedbackTotal : null,
      },
      knowledgeGaps: gapStats || { open: 0, occurrences: 0 },
    };
  }

  static async listKnowledgeGaps(organizationId: string, status?: string, limit = 100) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 250);
    return db.select().from(knowledgeGaps).where(and(
      eq(knowledgeGaps.organizationId, organizationId),
      status && GAP_STATUSES.has(status) ? eq(knowledgeGaps.status, status) : undefined,
    )).orderBy(desc(knowledgeGaps.occurrences), desc(knowledgeGaps.lastSeenAt)).limit(safeLimit);
  }

  static async recordKnowledgeGap(data: {
    organizationId: string;
    topic: string;
    summary: string;
    sourceConversationId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const topic = normalize(data.topic, 120);
    const summary = normalize(data.summary, 700);
    if (topic.length < 3 || summary.length < 8) throw new Error("Knowledge gap requires a topic and summary");

    if (data.sourceConversationId) {
      const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(
        eq(conversations.organizationId, data.organizationId),
        eq(conversations.id, data.sourceConversationId),
      )).limit(1);
      if (!conversation) throw new Error("Conversation not found");
    }

    const key = fingerprint(topic, summary);
    const now = new Date();
    const [gap] = await db.insert(knowledgeGaps).values({
      organizationId: data.organizationId,
      fingerprint: key,
      topic,
      summary,
      sourceConversationId: data.sourceConversationId,
      metadata: data.metadata || {},
      firstSeenAt: now,
      lastSeenAt: now,
    }).onConflictDoUpdate({
      target: [knowledgeGaps.organizationId, knowledgeGaps.fingerprint],
      set: {
        occurrences: sql`${knowledgeGaps.occurrences} + 1`,
        lastSeenAt: now,
        updatedAt: now,
        sourceConversationId: data.sourceConversationId,
      },
    }).returning();
    return gap;
  }

  static async updateKnowledgeGapStatus(organizationId: string, id: string, status: string) {
    if (!GAP_STATUSES.has(status)) throw new Error("Invalid knowledge gap status");
    const now = new Date();
    const [updated] = await db.update(knowledgeGaps).set({
      status,
      resolvedAt: status === "resolved" ? now : null,
      updatedAt: now,
    }).where(and(eq(knowledgeGaps.organizationId, organizationId), eq(knowledgeGaps.id, id))).returning();
    if (!updated) throw new Error("Knowledge gap not found");
    return updated;
  }

  static async topKnowledgeGaps(organizationId: string, limit = 10) {
    return this.listKnowledgeGaps(organizationId, undefined, Math.min(Math.max(limit, 1), 25));
  }
}
