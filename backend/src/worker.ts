import "./observability/tracing.js";
import { Worker } from "bullmq";
import { IngestionService } from "./services/ingestionService.js";
import { db } from "./db/index.js";
import { knowledgeSources } from "./db/schema.js";
import { eq } from "drizzle-orm";
import type { IngestionJob } from "./services/queueService.js";
import { logger, withLogContext, setLogContext } from "./observability/logger.js";
import { trace } from "@opentelemetry/api";
import { closeDatabasePool } from "./db/index.js";
import { shutdownTracing } from "./observability/tracing.js";
import { validateRuntimeConfiguration } from "./config/runtime.js";

validateRuntimeConfiguration();

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for the ingestion worker");

const worker = new Worker<IngestionJob>("ingestion", async (job) => trace.getTracer("ingestion-worker").startActiveSpan(`ingestion.${job.data.type}`, async (span) => withLogContext({ jobId: String(job.id), organizationId: job.data.organizationId }, async () => {
  try {
    setLogContext({ organizationId: job.data.organizationId });
    span.setAttribute("supportai.organization_id", job.data.organizationId);
  if (job.data.type === "document") {
    const result = await IngestionService.processTextDocument({ organizationId: job.data.organizationId, knowledgeBaseId: job.data.knowledgeBaseId, title: job.data.title, type: job.data.sourceType, content: job.data.content });
    if (job.data.securityStatus === "SUSPICIOUS") await db.update(knowledgeSources).set({ securityStatus: "SUSPICIOUS" }).where(eq(knowledgeSources.id, result.sourceId));
    return result;
  }
  if (job.data.type === "pdf") {
    const result = await IngestionService.processPdfBuffer({ organizationId: job.data.organizationId, knowledgeBaseId: job.data.knowledgeBaseId, title: job.data.title, filePath: job.data.filePath, buffer: Buffer.from(job.data.bufferBase64, "base64") });
    if (job.data.securityStatus === "SUSPICIOUS") await db.update(knowledgeSources).set({ securityStatus: "SUSPICIOUS" }).where(eq(knowledgeSources.id, result.sourceId));
    return result;
  }
  return IngestionService.crawlWebsite(job.data);
  } finally { span.end(); }
})) , { connection: { url: redisUrl, maxRetriesPerRequest: null }, concurrency: Number(process.env.INGESTION_WORKER_CONCURRENCY || 2) });

worker.on("completed", (job) => logger.info("ingestion.completed", { jobId: String(job.id), jobType: job.data.type, organizationId: job.data.organizationId }));
worker.on("failed", (job, error) => logger.error("ingestion.failed", { jobId: job ? String(job.id) : undefined, jobType: job?.data.type, organizationId: job?.data.organizationId, error: error.message }));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker.shutdown_started", { signal });
  const timer = setTimeout(() => { logger.error("worker.shutdown_timeout"); process.exit(1); }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 30_000));
  timer.unref();
  try {
    await worker.close(); // pauses fetching and waits for the active job
    await closeDatabasePool();
    await shutdownTracing();
    logger.info("worker.shutdown_complete", { signal });
    process.exitCode = 0;
  } catch (error) {
    logger.error("worker.shutdown_failed", { error: (error as Error).message });
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
}
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
