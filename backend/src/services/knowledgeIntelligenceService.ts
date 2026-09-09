import { and, count, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { knowledgeBases, knowledgeSources } from "../db/schema.js";
import { knowledgeFaqDrafts, knowledgeGaps, knowledgeRetrievalEvents, knowledgeSourceIntelligence } from "../db/supportAnalyticsSchema.js";

const PUBLICATION_STATUSES = new Set(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const HEALTH_STATUSES = new Set(["HEALTHY", "OUTDATED", "CRAWL_FAILED", "PROCESSING_FAILED", "EMPTY", "DUPLICATE", "NEEDS_REVIEW", "UNUSED", "MISSING_ARTIFACT"]);
const FAQ_STATUSES = new Set(["PENDING_REVIEW", "APPROVED", "REJECTED", "PUBLISHED"]);
const SOURCE_PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "AUTHORITATIVE"]);

function clampLimit(value: unknown, fallback = 50, max = 100) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
}

function clampOffset(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(100_000, Math.max(0, parsed)) : 0;
}

export class KnowledgeIntelligenceService {
  static async ensureSourceRecord(organizationId: string, sourceId: string) {
    const [source] = await db.select({ id: knowledgeSources.id }).from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, organizationId), eq(knowledgeSources.id, sourceId))).limit(1);
    if (!source) throw new Error("Knowledge source not found");
    const [record] = await db.insert(knowledgeSourceIntelligence).values({ organizationId, sourceId }).onConflictDoUpdate({ target: knowledgeSourceIntelligence.sourceId, set: { updatedAt: new Date() } }).returning();
    return record;
  }

  static async recomputeSourceHealth(organizationId: string, sourceId: string) {
    const [source] = await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, organizationId), eq(knowledgeSources.id, sourceId))).limit(1);
    if (!source) throw new Error("Knowledge source not found");
    const record = await this.ensureSourceRecord(organizationId, sourceId);
    const now = new Date();
    let health = "HEALTHY";
    if (source.status === "failed") health = source.type === "website" ? "CRAWL_FAILED" : "PROCESSING_FAILED";
    else if (source.status === "completed" && source.chunkCount === 0) health = "EMPTY";
    else if (source.status !== "completed") health = "NEEDS_REVIEW";
    else if (source.type === "website" && source.lastCrawledAt && now.getTime() - source.lastCrawledAt.getTime() > 30 * 86_400_000) health = "OUTDATED";
    else if (record.retrievalCount === 0 && source.createdAt.getTime() < now.getTime() - 30 * 86_400_000) health = "UNUSED";
    const [updated] = await db.update(knowledgeSourceIntelligence).set({ health, lastHealthCheckAt: now, updatedAt: now }).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, sourceId))).returning();
    return updated;
  }

  static async listSources(organizationId: string, query: Record<string, unknown>) {
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const publication = typeof query.publicationStatus === "string" && PUBLICATION_STATUSES.has(query.publicationStatus) ? query.publicationStatus : undefined;
    const health = typeof query.health === "string" && HEALTH_STATUSES.has(query.health) ? query.health : undefined;
    const q = typeof query.q === "string" ? query.q.trim().slice(0, 200) : "";
    let where = eq(knowledgeSources.organizationId, organizationId);
    if (query.knowledgeBaseId && typeof query.knowledgeBaseId === "string") where = and(where, eq(knowledgeSources.knowledgeBaseId, query.knowledgeBaseId))!;
    if (q) where = and(where, or(ilike(knowledgeSources.title, `%${q}%`), ilike(knowledgeSources.sourceUrl, `%${q}%`)))!;

    const rows = await db.select({ source: knowledgeSources, intelligence: knowledgeSourceIntelligence })
      .from(knowledgeSources)
      .leftJoin(knowledgeSourceIntelligence, and(eq(knowledgeSourceIntelligence.sourceId, knowledgeSources.id), eq(knowledgeSourceIntelligence.organizationId, organizationId)))
      .where(and(where,
        publication ? eq(knowledgeSourceIntelligence.publicationStatus, publication) : undefined,
        health ? eq(knowledgeSourceIntelligence.health, health) : undefined,
      ))
      .orderBy(desc(knowledgeSources.updatedAt), desc(knowledgeSources.id))
      .limit(limit)
      .offset(offset);
    return { limit, offset, items: rows.map(({ source, intelligence }) => ({ ...source, intelligence })) };
  }

  static async updateSourceSettings(organizationId: string, sourceId: string, input: Record<string, unknown>) {
    await this.ensureSourceRecord(organizationId, sourceId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.publicationStatus === "string") {
      if (!PUBLICATION_STATUSES.has(input.publicationStatus)) throw new Error("Invalid publication status");
      patch.publicationStatus = input.publicationStatus;
    }
    if (typeof input.priority === "string") {
      if (!SOURCE_PRIORITIES.has(input.priority)) throw new Error("Invalid source priority");
      patch.priority = input.priority;
    }
    if (typeof input.category === "string" || input.category === null) patch.category = input.category;
    if (typeof input.language === "string" || input.language === null) patch.language = input.language;
    if (Array.isArray(input.tags)) patch.tags = input.tags.filter((value): value is string => typeof value === "string").slice(0, 50).map((value) => value.trim().slice(0, 64)).filter(Boolean);
    if (typeof input.recrawlEnabled === "boolean") patch.recrawlEnabled = input.recrawlEnabled;
    if (input.recrawlIntervalMinutes === null) patch.recrawlIntervalMinutes = null;
    else if (typeof input.recrawlIntervalMinutes === "number" && Number.isInteger(input.recrawlIntervalMinutes) && input.recrawlIntervalMinutes >= 60 && input.recrawlIntervalMinutes <= 525_600) patch.recrawlIntervalMinutes = input.recrawlIntervalMinutes;
    const [updated] = await db.update(knowledgeSourceIntelligence).set(patch).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, sourceId))).returning();
    return updated;
  }

  static async getHealthOverview(organizationId: string, knowledgeBaseId?: string) {
    let sourceWhere = eq(knowledgeSources.organizationId, organizationId);
    if (knowledgeBaseId) sourceWhere = and(sourceWhere, eq(knowledgeSources.knowledgeBaseId, knowledgeBaseId))!;
    const rows = await db.select({ source: knowledgeSources, intelligence: knowledgeSourceIntelligence })
      .from(knowledgeSources)
      .leftJoin(knowledgeSourceIntelligence, and(eq(knowledgeSourceIntelligence.sourceId, knowledgeSources.id), eq(knowledgeSourceIntelligence.organizationId, organizationId)))
      .where(sourceWhere);

    const counts: Record<string, number> = {};
    let penalties = 0;
    for (const row of rows) {
      const health = row.intelligence?.health || (row.source.status === "failed" ? "PROCESSING_FAILED" : row.source.chunkCount === 0 ? "EMPTY" : "HEALTHY");
      counts[health] = (counts[health] || 0) + 1;
      penalties += ({ PROCESSING_FAILED: 20, CRAWL_FAILED: 20, MISSING_ARTIFACT: 20, EMPTY: 15, OUTDATED: 10, DUPLICATE: 7, NEEDS_REVIEW: 7, UNUSED: 3, HEALTHY: 0 } as Record<string, number>)[health] ?? 5;
    }
    const [gapStats] = await db.select({ open: sql<number>`count(*) filter (where ${knowledgeGaps.status} in ('OPEN','REVIEWING','CONTENT_DRAFTED','open','acknowledged'))::int`, occurrences: sql<number>`coalesce(sum(${knowledgeGaps.occurrences}) filter (where ${knowledgeGaps.status} not in ('RESOLVED','IGNORED','resolved','ignored')), 0)::int` }).from(knowledgeGaps).where(eq(knowledgeGaps.organizationId, organizationId));
    const openGaps = Number(gapStats?.open || 0);
    const occurrences = Number(gapStats?.occurrences || 0);
    penalties += Math.min(25, openGaps * 2 + Math.floor(occurrences / 10));
    const score = Math.max(0, Math.min(100, 100 - penalties));
    const factors = Object.entries(counts).filter(([key]) => key !== "HEALTHY").map(([key, value]) => ({ code: key, count: value }));
    if (openGaps) factors.push({ code: "OPEN_KNOWLEDGE_GAPS", count: openGaps });
    return { score, totalSources: rows.length, counts, openGaps, gapOccurrences: occurrences, factors };
  }

  static async recordRetrieval(data: { organizationId: string; conversationId?: string; sourceId: string; chunkId?: string; revision?: number; relevanceScore?: number; usedInFinalAnswer?: boolean }) {
    await this.ensureSourceRecord(data.organizationId, data.sourceId);
    const now = new Date();
    const [event] = await db.insert(knowledgeRetrievalEvents).values({
      organizationId: data.organizationId,
      conversationId: data.conversationId,
      sourceId: data.sourceId,
      chunkId: data.chunkId,
      revision: data.revision,
      relevanceScore: data.relevanceScore,
      usedInFinalAnswer: Boolean(data.usedInFinalAnswer),
    }).returning();
    await db.update(knowledgeSourceIntelligence).set({
      retrievalCount: sql`${knowledgeSourceIntelligence.retrievalCount} + 1`,
      answerUsageCount: data.usedInFinalAnswer ? sql`${knowledgeSourceIntelligence.answerUsageCount} + 1` : knowledgeSourceIntelligence.answerUsageCount,
      lastRetrievedAt: now,
      lastUsedInAnswerAt: data.usedInFinalAnswer ? now : undefined,
      updatedAt: now,
    }).where(and(eq(knowledgeSourceIntelligence.organizationId, data.organizationId), eq(knowledgeSourceIntelligence.sourceId, data.sourceId)));
    return event;
  }

  static async listRetrievalEvents(organizationId: string, sourceId: string, limitValue?: unknown) {
    const limit = clampLimit(limitValue, 50, 100);
    const [source] = await db.select({ id: knowledgeSources.id }).from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, organizationId), eq(knowledgeSources.id, sourceId))).limit(1);
    if (!source) throw new Error("Knowledge source not found");
    return db.select().from(knowledgeRetrievalEvents).where(and(eq(knowledgeRetrievalEvents.organizationId, organizationId), eq(knowledgeRetrievalEvents.sourceId, sourceId))).orderBy(desc(knowledgeRetrievalEvents.createdAt)).limit(limit);
  }

  static async createFaqDraft(data: { organizationId: string; knowledgeBaseId: string; gapId?: string; question: string; answer: string; language?: string; category?: string; tags?: string[]; confidence?: number; evidence?: unknown[]; createdByUserId?: string }) {
    const [base] = await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(and(eq(knowledgeBases.organizationId, data.organizationId), eq(knowledgeBases.id, data.knowledgeBaseId))).limit(1);
    if (!base) throw new Error("Knowledge base not found");
    if (data.gapId) {
      const [gap] = await db.select({ id: knowledgeGaps.id }).from(knowledgeGaps).where(and(eq(knowledgeGaps.organizationId, data.organizationId), eq(knowledgeGaps.id, data.gapId))).limit(1);
      if (!gap) throw new Error("Knowledge gap not found");
    }
    const question = data.question.trim().slice(0, 500);
    const answer = data.answer.trim().slice(0, 20_000);
    if (question.length < 3 || answer.length < 3) throw new Error("FAQ draft requires question and answer");
    const [draft] = await db.insert(knowledgeFaqDrafts).values({ organizationId: data.organizationId, knowledgeBaseId: data.knowledgeBaseId, gapId: data.gapId, question, answer, language: data.language?.slice(0, 32), category: data.category?.slice(0, 120), tags: (data.tags || []).slice(0, 50), confidence: data.confidence, evidence: (data.evidence || []).slice(0, 50), createdByUserId: data.createdByUserId }).returning();
    if (data.gapId) await db.update(knowledgeGaps).set({ status: "CONTENT_DRAFTED", updatedAt: new Date() }).where(and(eq(knowledgeGaps.organizationId, data.organizationId), eq(knowledgeGaps.id, data.gapId)));
    return draft;
  }

  static async listFaqDrafts(organizationId: string, status?: string, limitValue?: unknown) {
    const limit = clampLimit(limitValue, 50, 100);
    const validStatus = status && FAQ_STATUSES.has(status) ? status : undefined;
    return db.select().from(knowledgeFaqDrafts).where(and(eq(knowledgeFaqDrafts.organizationId, organizationId), validStatus ? eq(knowledgeFaqDrafts.reviewStatus, validStatus) : undefined)).orderBy(desc(knowledgeFaqDrafts.updatedAt)).limit(limit);
  }

  static async reviewFaqDraft(organizationId: string, id: string, status: string, reviewerUserId: string) {
    if (!new Set(["APPROVED", "REJECTED"]).has(status)) throw new Error("Invalid FAQ review status");
    const [updated] = await db.update(knowledgeFaqDrafts).set({ reviewStatus: status, reviewedByUserId: reviewerUserId, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(knowledgeFaqDrafts.organizationId, organizationId), eq(knowledgeFaqDrafts.id, id), inArray(knowledgeFaqDrafts.reviewStatus, ["PENDING_REVIEW", "APPROVED"]))).returning();
    if (!updated) throw new Error("FAQ draft not found");
    return updated;
  }

  static async publishFaqDraft(organizationId: string, id: string, reviewerUserId: string) {
    return db.transaction(async (tx) => {
      const [draft] = await tx.select().from(knowledgeFaqDrafts).where(and(eq(knowledgeFaqDrafts.organizationId, organizationId), eq(knowledgeFaqDrafts.id, id))).limit(1);
      if (!draft) throw new Error("FAQ draft not found");
      if (draft.reviewStatus === "PUBLISHED" && draft.publishedSourceId) return draft;
      if (draft.reviewStatus !== "APPROVED") throw new Error("FAQ draft must be approved before publishing");
      const [source] = await tx.insert(knowledgeSources).values({ organizationId, knowledgeBaseId: draft.knowledgeBaseId, title: draft.question.slice(0, 300), type: "faq", status: "pending", metadata: { faqQuestion: draft.question, faqAnswer: draft.answer, category: draft.category, language: draft.language, tags: draft.tags, generatedFromGapId: draft.gapId } }).returning();
      await tx.insert(knowledgeSourceIntelligence).values({ organizationId, sourceId: source.id, publicationStatus: "DRAFT", category: draft.category, language: draft.language, tags: draft.tags }).onConflictDoNothing({ target: knowledgeSourceIntelligence.sourceId });
      const [published] = await tx.update(knowledgeFaqDrafts).set({ reviewStatus: "PUBLISHED", publishedSourceId: source.id, reviewedByUserId: reviewerUserId, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(knowledgeFaqDrafts.organizationId, organizationId), eq(knowledgeFaqDrafts.id, id))).returning();
      if (draft.gapId) await tx.update(knowledgeGaps).set({ status: "RESOLVED", resolvedAt: new Date(), updatedAt: new Date() }).where(and(eq(knowledgeGaps.organizationId, organizationId), eq(knowledgeGaps.id, draft.gapId)));
      return published;
    });
  }
}
