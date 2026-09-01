import Redis from "ioredis";
import { IngestionService } from "./ingestionService.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

class QueueService {
  private redis: Redis | null = null;
  private isConnected = false;

  constructor() {
    try {
      this.redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // don't crash on connection refusal
      });

      this.redis.on("connect", () => {
        this.isConnected = true;
        console.log("Redis connected for background job queue");
      });

      this.redis.on("error", (err) => {
        this.isConnected = false;
        // Silent catch for dev/standalone mode
      });
    } catch (e) {
      this.isConnected = false;
    }
  }

  // Dispatch Document Ingestion Task
  async enqueueDocumentIngestion(taskData: {
    organizationId: string;
    knowledgeBaseId: string;
    title: string;
    type: "faq" | "document";
    content: string;
  }) {
    if (this.isConnected && this.redis) {
      await this.redis.rpush("queue:ingestion", JSON.stringify({ type: "doc", payload: taskData }));
    }

    // Execute asynchronously without blocking request
    setImmediate(async () => {
      try {
        await IngestionService.processTextDocument(taskData);
      } catch (err) {
        console.error("Background document ingestion error:", (err as Error).message);
      }
    });
  }

  // Dispatch Website Crawl Task
  async enqueueWebsiteCrawl(taskData: {
    organizationId: string;
    knowledgeBaseId: string;
    targetUrl: string;
    maxPages?: number;
  }) {
    if (this.isConnected && this.redis) {
      await this.redis.rpush("queue:ingestion", JSON.stringify({ type: "crawl", payload: taskData }));
    }

    setImmediate(async () => {
      try {
        await IngestionService.crawlWebsite(taskData);
      } catch (err) {
        console.error("Background website crawl error:", (err as Error).message);
      }
    });
  }
}

export const queueService = new QueueService();
