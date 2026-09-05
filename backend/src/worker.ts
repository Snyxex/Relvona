import "dotenv/config";
import "./observability/tracing.js";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { createHash } from "node:crypto";
import { gt } from "drizzle-orm";
import { db, closeDatabasePool } from "./db/index.js";
import { organizations } from "./db/schema.js";
import { IngestionJobService } from "./services/ingestionJobService.js";
import { closeQueues, publishIngestion } from "./services/queueService.js";
import type { IngestionInput, IngestionReference } from "./services/ingestionTypes.js";
import { logger, withLogContext, setLogContext } from "./observability/logger.js";
import { trace } from "@opentelemetry/api";
import { shutdownTracing } from "./observability/tracing.js";
import { validateRuntimeConfiguration } from "./config/runtime.js";

validateRuntimeConfiguration();
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for the ingestion worker");
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
connection.on("error", () => logger.warn("ingestion.worker_redis_unavailable"));
type LegacyJob = { type: "document" | "pdf" | "crawl"; organizationId: string; knowledgeBaseId: string; title: string; sourceType: "document" | "faq"; content: string; filePath: string; bufferBase64: string; targetUrl: string; maxPages?: number };

const worker = new Worker<IngestionReference | LegacyJob>("ingestion", async (job) => trace.getTracer("ingestion-worker").startActiveSpan("ingestion.process", async (span) => withLogContext({ jobId: String(job.id) }, async () => {
  try {
    setLogContext({ organizationId: job.data.organizationId });
    let ref: IngestionReference;
    if ("jobId" in job.data) ref = job.data;
    else {
      // Existing Redis jobs are imported once; replay after a crash keeps the same source.
      const old = job.data;
      const input: IngestionInput = old.type === "pdf"
        ? { type: "pdf", knowledgeBaseId: old.knowledgeBaseId, title: old.title, filename: old.filePath, bufferBase64: old.bufferBase64 }
        : old.type === "crawl" ? { type: "website", knowledgeBaseId: old.knowledgeBaseId, title: old.targetUrl, targetUrl: old.targetUrl, maxPages: old.maxPages ?? 20, maxDepth: 2 }
        : { type: old.sourceType, knowledgeBaseId: old.knowledgeBaseId, title: old.title, content: old.content };
      const hex = createHash("sha256").update(`legacy-ingestion:${old.organizationId}:${job.id}`).digest("hex");
      const legacyId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      ref = await IngestionJobService.submit(old.organizationId, input, undefined, legacyId);
    }
    return await IngestionJobService.process(ref);
  } finally { span.end(); }
})), { connection, concurrency: Number(process.env.INGESTION_WORKER_CONCURRENCY || 2) });
worker.on("error", () => logger.warn("ingestion.worker_error"));
worker.on("completed", (job) => logger.info("ingestion.delivery_completed", { jobId: String(job.id), organizationId: job.data.organizationId }));
worker.on("failed", (job) => logger.error("ingestion.delivery_failed", { jobId: job?.id, organizationId: job?.data.organizationId }));

let shuttingDown = false;
let dispatching: Promise<void> | undefined;
async function dispatch() {
  let cursor: string | undefined;
  while (!shuttingDown) {
    // Organization identities are bootstrap data. Every job lookup uses scoped RLS transactions.
    const tenants = await db.select({ id: organizations.id }).from(organizations).where(cursor ? gt(organizations.id, cursor) : undefined).orderBy(organizations.id).limit(100);
    if (!tenants.length) return;
    for (const tenant of tenants) {
      if (shuttingDown) return;
      const pending = await IngestionJobService.pending(tenant.id);
      for (const ref of pending) await publishIngestion(ref);
    }
    cursor = tenants[tenants.length - 1].id;
  }
}
function scheduleDispatch() {
  if (dispatching || shuttingDown) return;
  dispatching = dispatch().catch(() => logger.warn("ingestion.dispatch_retry_pending")).finally(() => { dispatching = undefined; });
}
const dispatchTimer = setInterval(scheduleDispatch, 10_000);
scheduleDispatch();

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(dispatchTimer);
  logger.info("worker.shutdown_started", { signal });
  const timer = setTimeout(() => { logger.error("worker.shutdown_timeout"); process.exit(1); }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 30_000));
  timer.unref();
  try {
    await worker.close();
    await dispatching;
    await closeQueues();
    connection.disconnect();
    await closeDatabasePool();
    await shutdownTracing();
    logger.info("worker.shutdown_complete", { signal });
    process.exitCode = 0;
  } catch { process.exitCode = 1; }
  finally { clearTimeout(timer); }
}
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });