import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { documentChunks, knowledgeBases, knowledgeIngestionJobs as jobs, knowledgeSources, websites, websitePages, organizationSettings } from "../db/schema.js";
import { IngestionService, type PreparedSource } from "./ingestionService.js";
import { canCommitIngestion, INGESTION_LEASE_MS, MAX_INGESTION_ATTEMPTS, type IngestionInput, type IngestionReference } from "./ingestionTypes.js";
import { decryptSecret } from "../utils/crypto.js";

export class IngestionInputError extends Error {}

export function validateIngestionInput(input: IngestionInput) {
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 300) throw new IngestionInputError("Title must contain 1–300 characters");
  if (input.category !== undefined && (typeof input.category !== "string" || input.category.length > 120)) throw new IngestionInputError("Invalid category");
  if (input.language !== undefined && (typeof input.language !== "string" || !/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(input.language))) throw new IngestionInputError("Invalid language");
  if (input.type === "document" || input.type === "faq") {
    if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 500_000) throw new IngestionInputError("Content must contain 1–500,000 characters");
  } else if (input.type === "website") {
    if (!Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 50 || !Number.isInteger(input.maxDepth) || input.maxDepth < 0 || input.maxDepth > 5) throw new IngestionInputError("Crawl limits: 1–50 pages and depth 0–5");
    try { const url = new URL(input.targetUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { throw new IngestionInputError("Invalid public website URL"); }
  } else if (input.type === "pdf") {
    if (typeof input.bufferBase64 !== "string" || input.bufferBase64.length > 14_000_000 || typeof input.filename !== "string" || !input.filename.toLowerCase().endsWith(".pdf")) throw new IngestionInputError("Invalid PDF input");
  } else throw new IngestionInputError("Unsupported source type");
}

export class IngestionJobService {
  static async submit(organizationId: string, input: IngestionInput, sourceId?: string, legacyId?: string) {
    validateIngestionInput(input);
    return withTenantTransaction(organizationId, async (tx) => {
      if (legacyId) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${legacyId}, 0))`);
        const [imported] = await tx.select().from(jobs).where(and(eq(jobs.id, legacyId), eq(jobs.organizationId, organizationId))).limit(1);
        if (imported) return { sourceId: imported.sourceId, jobId: imported.id, organizationId, revision: imported.revision, attempt: imported.attempts, status: imported.status };
      }
      const [base] = await tx.select({ id: knowledgeBases.id }).from(knowledgeBases).where(and(eq(knowledgeBases.id, input.knowledgeBaseId), eq(knowledgeBases.organizationId, organizationId))).limit(1);
      if (!base) throw new IngestionInputError("Knowledge base not found");
      const [existingJob] = sourceId ? await tx.select().from(jobs).where(and(eq(jobs.sourceId, sourceId), eq(jobs.organizationId, organizationId))).for("update") : [];
      const [existingSource] = sourceId ? await tx.select().from(knowledgeSources).where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, organizationId))).limit(1) : [];
      if (sourceId && !existingSource) throw new IngestionInputError("Knowledge source not found");
      if (existingSource && (existingSource.type !== input.type || existingSource.knowledgeBaseId !== input.knowledgeBaseId)) throw new IngestionInputError("Source type and knowledge base cannot be changed");
      let websiteId = (existingSource?.metadata as { websiteId?: string } | null)?.websiteId;
      if (input.type === "website" && !websiteId) {
        const [website] = await tx.insert(websites).values({ organizationId, knowledgeBaseId: input.knowledgeBaseId, rootUrl: input.targetUrl, maxPages: input.maxPages, maxDepth: input.maxDepth, crawlStatus: "queued" }).returning();
        websiteId = website.id;
      }
      const sourceValues = { title: input.title.trim(), status: "queued", errorMessage: null, updatedAt: new Date(), metadata: { category: input.category || null, language: input.language || "und", websiteId }, sourceUrl: input.type === "website" ? input.targetUrl : null };
      const [source] = existingSource
        ? await tx.update(knowledgeSources).set(sourceValues).where(and(eq(knowledgeSources.id, existingSource.id), eq(knowledgeSources.organizationId, organizationId))).returning()
        : await tx.insert(knowledgeSources).values({ ...sourceValues, organizationId, knowledgeBaseId: input.knowledgeBaseId, type: input.type, filePath: input.type === "pdf" ? input.filename : null }).returning();
      const revision = (existingJob?.revision || 0) + 1;
      const jobValues = { payload: input, revision, status: "queued", attempts: 0, leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(), errorMessage: null, startedAt: null, finishedAt: null, updatedAt: new Date() };
      const [job] = existingJob
        ? await tx.update(jobs).set(jobValues).where(eq(jobs.id, existingJob.id)).returning()
        : await tx.insert(jobs).values({ ...jobValues, id: legacyId, organizationId, sourceId: source.id }).returning();
      if (websiteId) await tx.update(websites).set({ crawlStatus: "queued" }).where(and(eq(websites.id, websiteId), eq(websites.organizationId, organizationId)));
      return { sourceId: source.id, jobId: job.id, organizationId, revision, attempt: 0, status: "queued" };
    });
  }

  static async inputFor(organizationId: string, sourceId: string) {
    return withTenantTransaction(organizationId, async (tx) => {
      const [job] = await tx.select({ payload: jobs.payload }).from(jobs).where(and(eq(jobs.sourceId, sourceId), eq(jobs.organizationId, organizationId))).limit(1);
      if (job) return job.payload as IngestionInput;
      const [source] = await tx.select().from(knowledgeSources).where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, organizationId))).limit(1);
      if (source?.type === "website" && source.sourceUrl) return { type: "website", title: source.title, knowledgeBaseId: source.knowledgeBaseId, targetUrl: source.sourceUrl, maxPages: 1, maxDepth: 0 } as IngestionInput;
      throw new IngestionInputError("Original input unavailable; upload the document again");
    });
  }

  private static async prepareForOrganization(organizationId: string, input: IngestionInput) {
    const [settings] = await withTenantTransaction(organizationId, (tx) => tx.select({ openaiKeyEncrypted: organizationSettings.openaiKeyEncrypted }).from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId)).limit(1));
    return IngestionService.prepare(input, { apiKey: decryptSecret(settings?.openaiKeyEncrypted) });
  }

  static async process(ref: IngestionReference, prepare?: (input: IngestionInput) => Promise<PreparedSource>) {
    const token = randomUUID();
    const claimed = await withTenantTransaction(ref.organizationId, async (tx) => {
      const [job] = await tx.update(jobs).set({ status: "processing", leaseToken: token, leaseUntil: new Date(Date.now() + INGESTION_LEASE_MS), attempts: sql`${jobs.attempts} + 1`, startedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(jobs.id, ref.jobId), eq(jobs.organizationId, ref.organizationId), eq(jobs.revision, ref.revision), eq(jobs.attempts, ref.attempt), lt(jobs.attempts, MAX_INGESTION_ATTEMPTS), lte(jobs.nextAttemptAt, new Date()), or(eq(jobs.status, "queued"), and(eq(jobs.status, "processing"), lt(jobs.leaseUntil, new Date()))))).returning();
      if (job) await tx.update(knowledgeSources).set({ status: "processing", updatedAt: new Date() }).where(and(eq(knowledgeSources.id, job.sourceId), eq(knowledgeSources.organizationId, ref.organizationId)));
      return job;
    });
    if (!claimed) return { skipped: true };
    try {
      const input = claimed.payload as IngestionInput;
      const prepared = prepare ? await prepare(input) : await this.prepareForOrganization(ref.organizationId, input);
      return await this.complete(ref, token, prepared);
    } catch {
      // Provider error bodies can include credentials or internal URLs. Store only a public error.
      await withTenantTransaction(ref.organizationId, async (tx) => {
        const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, ref.jobId), eq(jobs.organizationId, ref.organizationId))).for("update");
        if (!canCommitIngestion(job, ref.revision, token)) return;
        const status = job.attempts >= MAX_INGESTION_ATTEMPTS ? "failed" : "queued";
        const errorMessage = "Processing failed. Check the source and embedding provider configuration, then retry.";
        await tx.update(jobs).set({ status, errorMessage, leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + job.attempts * 5_000), finishedAt: status === "failed" ? new Date() : null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
        await tx.update(knowledgeSources).set({ status, errorMessage, updatedAt: new Date() }).where(and(eq(knowledgeSources.id, job.sourceId), eq(knowledgeSources.organizationId, ref.organizationId)));
      });
      return { failed: true };
    }
  }

  private static async complete(ref: IngestionReference, token: string, result: PreparedSource) {
    return withTenantTransaction(ref.organizationId, async (tx) => {
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, ref.jobId), eq(jobs.organizationId, ref.organizationId))).for("update");
      if (!canCommitIngestion(job, ref.revision, token)) return { skipped: true };
      const [source] = await tx.select().from(knowledgeSources).where(and(eq(knowledgeSources.id, job.sourceId), eq(knowledgeSources.organizationId, ref.organizationId))).limit(1);
      if (!source) return { skipped: true };
      // Replacing chunks and publishing completion is atomic. Old/deleted workers cannot restore data.
      await tx.delete(documentChunks).where(and(eq(documentChunks.sourceId, source.id), eq(documentChunks.organizationId, ref.organizationId)));
      for (let offset = 0; offset < result.chunks.length; offset += 32) {
        await tx.insert(documentChunks).values(result.chunks.slice(offset, offset + 32).map((chunk, index) => ({ organizationId: ref.organizationId, knowledgeBaseId: source.knowledgeBaseId, sourceId: source.id, chunkIndex: offset + index, content: chunk.content, embedding: chunk.embedding, metadata: { ...chunk.metadata, documentId: source.id, version: ref.revision } })));
      }
      const crawledAt = source.type === "website" ? new Date() : null;
      await tx.update(knowledgeSources).set({ status: "completed", errorMessage: null, chunkCount: result.chunks.length, securityStatus: result.securityStatus, contentHash: result.contentHash, lastCrawledAt: crawledAt, updatedAt: new Date() }).where(eq(knowledgeSources.id, source.id));
      const websiteId = (source.metadata as { websiteId?: string } | null)?.websiteId;
      if (websiteId && source.type === "website") {
        const [website] = await tx.select({ id: websites.id }).from(websites).where(and(eq(websites.id, websiteId), eq(websites.organizationId, ref.organizationId))).limit(1);
        if (website) {
          await tx.delete(websitePages).where(and(eq(websitePages.websiteId, website.id), eq(websitePages.organizationId, ref.organizationId)));
          if (result.pages.length) await tx.insert(websitePages).values(result.pages.map((page) => ({ ...page, websiteId: website.id, organizationId: ref.organizationId })));
          await tx.update(websites).set({ crawlStatus: "completed", lastCrawledAt: crawledAt }).where(eq(websites.id, website.id));
        }
      }
      await tx.update(jobs).set({ status: "completed", errorMessage: null, leaseToken: null, leaseUntil: null, finishedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id));
      return { sourceId: source.id, chunkCount: result.chunks.length };
    });
  }

  static async pending(organizationId: string) {
    return withTenantTransaction(organizationId, async (tx) => {
      const exhausted = await tx.update(jobs).set({ status: "failed", leaseToken: null, leaseUntil: null, errorMessage: "Processing interrupted repeatedly. Please retry.", finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(jobs.organizationId, organizationId), eq(jobs.status, "processing"), lt(jobs.leaseUntil, new Date()), sql`${jobs.attempts} >= ${MAX_INGESTION_ATTEMPTS}`)).returning({ sourceId: jobs.sourceId });
      if (exhausted.length) await tx.update(knowledgeSources).set({ status: "failed", errorMessage: "Processing interrupted repeatedly. Please retry.", updatedAt: new Date() }).where(and(eq(knowledgeSources.organizationId, organizationId), inArray(knowledgeSources.id, exhausted.map((job) => job.sourceId))));
      return tx.select({ jobId: jobs.id, organizationId: jobs.organizationId, revision: jobs.revision, attempt: jobs.attempts }).from(jobs)
        .where(and(eq(jobs.organizationId, organizationId), lt(jobs.attempts, MAX_INGESTION_ATTEMPTS), lte(jobs.nextAttemptAt, new Date()), or(eq(jobs.status, "queued"), and(eq(jobs.status, "processing"), lt(jobs.leaseUntil, new Date())))))
        .orderBy(jobs.nextAttemptAt).limit(50);
    });
  }
}
