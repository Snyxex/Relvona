import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL;
if (process.env.NODE_ENV === "production" && !redisUrl) throw new Error("REDIS_URL is required for ingestion jobs");
const connection = { url: redisUrl || "redis://localhost:6379", maxRetriesPerRequest: null };

export type IngestionJob =
  | { type: "document"; organizationId: string; knowledgeBaseId: string; title: string; sourceType: "faq" | "document"; content: string; securityStatus: "SAFE" | "SUSPICIOUS" | "QUARANTINED" }
  | { type: "pdf"; organizationId: string; knowledgeBaseId: string; title: string; filePath: string; bufferBase64: string; securityStatus: "SAFE" | "SUSPICIOUS" | "QUARANTINED" }
  | { type: "crawl"; organizationId: string; knowledgeBaseId: string; targetUrl: string; maxPages?: number };

export const ingestionQueue = new Queue<IngestionJob>("ingestion", { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 500, removeOnFail: 1_000 } });

class QueueService {
  async enqueueDocumentIngestion(job: Omit<Extract<IngestionJob, { type: "document" }>, "type">) { return ingestionQueue.add("document", { type: "document", ...job }); }
  async enqueuePdfIngestion(job: Omit<Extract<IngestionJob, { type: "pdf" }>, "type">) { return ingestionQueue.add("pdf", { type: "pdf", ...job }); }
  async enqueueWebsiteCrawl(job: Omit<Extract<IngestionJob, { type: "crawl" }>, "type">) { return ingestionQueue.add("crawl", { type: "crawl", ...job }); }
}

export const queueService = new QueueService();
