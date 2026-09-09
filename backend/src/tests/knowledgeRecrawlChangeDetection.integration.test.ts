import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { documentChunks, knowledgeIngestionJobs, knowledgeSources } from "../db/schema.js";
import { knowledgeSourceIntelligence } from "../db/supportAnalyticsSchema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { IngestionJobService } from "../services/ingestionJobService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for recrawl change detection tests");

const organizationId = randomUUID();
const knowledgeBaseId = randomUUID();
const sourceId = randomUUID();
const chunkId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });
const payload = {
  type: "website" as const,
  title: "Tracked website",
  knowledgeBaseId,
  targetUrl: "https://example.com/",
  maxPages: 10,
  maxDepth: 2,
};

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Change Detection', $2)", [organizationId, `change-${organizationId}`]);
    await admin.query("INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'Primary')", [knowledgeBaseId, organizationId]);
    await admin.query(`
      INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type, source_url, status, security_status, chunk_count, content_hash, current_revision, last_crawled_at)
      VALUES ($1, $2, $3, 'Tracked website', 'website', 'https://example.com/', 'completed', 'SAFE', 1, 'same-hash', 2, now() - interval '1 day')
    `, [sourceId, organizationId, knowledgeBaseId]);
    await admin.query("INSERT INTO document_chunks (id, organization_id, knowledge_base_id, source_id, chunk_index, content) VALUES ($1, $2, $3, $4, 0, 'ORIGINAL CHUNK')", [chunkId, organizationId, knowledgeBaseId, sourceId]);
    await admin.query("INSERT INTO knowledge_source_intelligence (organization_id, source_id, publication_status, health, recrawl_enabled, recrawl_interval_minutes) VALUES ($1, $2, 'PUBLISHED', 'OUTDATED', true, 60)", [organizationId, sourceId]);
    await admin.query("INSERT INTO knowledge_ingestion_jobs (organization_id, source_id, payload, revision, status, attempts) VALUES ($1, $2, $3::jsonb, 2, 'completed', 1)", [organizationId, sourceId, JSON.stringify(payload)]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const ref = await IngestionJobService.submit(organizationId, payload, sourceId);
      assert.equal(ref.revision, 3, "the durable ingestion run may advance independently of content revision");

      const result = await IngestionJobService.process(ref, async () => ({
        title: payload.title,
        contentHash: "same-hash",
        securityStatus: "SAFE",
        normalizedText: "same normalized website text",
        chunks: [{ content: "REPLACEMENT MUST NOT BE WRITTEN", embedding: [], metadata: {} }],
        pages: [{ url: payload.targetUrl, title: payload.title, contentHash: "same-page", chunkCount: 1 }],
      }));
      assert.equal((result as { unchanged?: boolean }).unchanged, true, "same content hash must use the unchanged completion path");

      const chunks = await db.select().from(documentChunks).where(and(eq(documentChunks.organizationId, organizationId), eq(documentChunks.sourceId, sourceId)));
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].id, chunkId, "existing chunk identity must be preserved");
      assert.equal(chunks[0].content, "ORIGINAL CHUNK", "unchanged recrawl must not replace chunks");

      const [source] = await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, organizationId), eq(knowledgeSources.id, sourceId))).limit(1);
      assert.equal(source.currentRevision, 2, "unchanged recrawl must keep the prior content revision");
      assert.equal(source.status, "completed");
      assert.equal(source.contentHash, "same-hash");

      const [intel] = await db.select().from(knowledgeSourceIntelligence).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, sourceId))).limit(1);
      assert.equal(intel.health, "HEALTHY");
      assert.ok(intel.lastSuccessfulCrawlAt, "successful unchanged crawl must refresh source health metadata");

      const [job] = await db.select().from(knowledgeIngestionJobs).where(and(eq(knowledgeIngestionJobs.organizationId, organizationId), eq(knowledgeIngestionJobs.sourceId, sourceId))).limit(1);
      assert.equal(job.status, "completed");
      assert.equal(job.revision, 3, "operational ingestion revision remains monotonic for stale-worker protection");
    });

    console.log("Knowledge recrawl change detection integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
