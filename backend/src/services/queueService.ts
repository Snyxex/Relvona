import { Queue } from "bullmq";
import Redis from "ioredis";
import { IngestionJobService } from "./ingestionJobService.js";
import { ingestionQueueId, type IngestionInput, type IngestionReference } from "./ingestionTypes.js";
import { logger } from "../observability/logger.js";

const redisUrl = process.env.REDIS_URL;
if (process.env.NODE_ENV === "production" && !redisUrl) throw new Error("REDIS_URL is required for ingestion jobs");
const connection = new Redis(redisUrl || "redis://localhost:6379", { maxRetriesPerRequest: 1, enableOfflineQueue: false });
connection.on("error", () => logger.warn("ingestion.redis_unavailable"));
export const ingestionQueue = new Queue<IngestionReference>("ingestion", { connection, defaultJobOptions: { attempts: 1, removeOnComplete: 500, removeOnFail: 1_000 } });
ingestionQueue.on("error", () => logger.warn("ingestion.queue_unavailable"));

export async function publishIngestion(ref: IngestionReference) {
  // PostgreSQL owns retries; each persisted attempt has a stable queue identity.
  const existing = await ingestionQueue.getJob(ingestionQueueId(ref));
  if (existing && ["failed", "completed"].includes(await existing.getState())) await existing.remove();
  return ingestionQueue.add("ingest", ref, { jobId: ingestionQueueId(ref) });
}

export const queueService = {
  async submit(organizationId: string, input: IngestionInput, sourceId?: string) {
    const ref = await IngestionJobService.submit(organizationId, input, sourceId);
    // A Redis outage must not lose input or turn an accepted submission into an apparent failure.
    void publishIngestion(ref).catch(() => logger.warn("ingestion.dispatch_pending", { jobId: ref.jobId, organizationId }));
    return { ...ref, id: ref.jobId };
  },
  async enqueueDocumentIngestion(job: { organizationId: string; knowledgeBaseId: string; title: string; sourceType: "faq" | "document"; content: string; securityStatus: string; category?: string; language?: string }) {
    return this.submit(job.organizationId, { type: job.sourceType, knowledgeBaseId: job.knowledgeBaseId, title: job.title, content: job.content, category: job.category, language: job.language });
  },
  async enqueuePdfIngestion(job: { organizationId: string; knowledgeBaseId: string; title: string; filePath: string; bufferBase64: string; securityStatus: string }) {
    return this.submit(job.organizationId, { type: "pdf", knowledgeBaseId: job.knowledgeBaseId, title: job.title, filename: job.filePath, bufferBase64: job.bufferBase64 });
  },
  async enqueueWebsiteCrawl(job: { organizationId: string; knowledgeBaseId: string; targetUrl: string; maxPages?: number; maxDepth?: number }) {
    return this.submit(job.organizationId, { type: "website", knowledgeBaseId: job.knowledgeBaseId, title: job.targetUrl, targetUrl: job.targetUrl, maxPages: job.maxPages ?? 20, maxDepth: job.maxDepth ?? 2 });
  },
};

export async function closeQueues() { await ingestionQueue.close(); connection.disconnect(); }