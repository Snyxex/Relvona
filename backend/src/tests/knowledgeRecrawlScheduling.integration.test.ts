import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { knowledgeSources } from "../db/schema.js";
import { knowledgeSourceIntelligence } from "../db/supportAnalyticsSchema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { KnowledgeRecrawlService } from "../services/knowledgeRecrawlService.js";
import { closeQueues } from "../services/queueService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for recrawl scheduling tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const knowledgeBaseId = randomUUID();
const otherKnowledgeBaseId = randomUUID();
const dueSourceId = randomUUID();
const recentSourceId = randomUUID();
const foreignSourceId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  const now = new Date("2026-09-09T10:00:00.000Z");
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Recrawl A', $2), ($3, 'Recrawl B', $4)", [organizationId, `recrawl-${organizationId}`, otherOrganizationId, `recrawl-${otherOrganizationId}`]);
    await admin.query("INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'Primary'), ($3, $4, 'Foreign')", [knowledgeBaseId, organizationId, otherKnowledgeBaseId, otherOrganizationId]);
    await admin.query(`
      INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type, source_url, status, security_status, chunk_count, current_revision, last_crawled_at)
      VALUES
        ($1, $2, $3, 'Due', 'website', 'https://example.com/due', 'completed', 'SAFE', 1, 1, $4),
        ($5, $2, $3, 'Recent', 'website', 'https://example.com/recent', 'completed', 'SAFE', 1, 1, $6),
        ($7, $8, $9, 'Foreign', 'website', 'https://example.org', 'completed', 'SAFE', 1, 1, $4)
    `, [dueSourceId, organizationId, knowledgeBaseId, new Date(now.getTime() - 3 * 60 * 60_000), recentSourceId, new Date(now.getTime() - 10 * 60_000), foreignSourceId, otherOrganizationId, otherKnowledgeBaseId]);
    await admin.query(`
      INSERT INTO knowledge_source_intelligence (organization_id, source_id, publication_status, recrawl_enabled, recrawl_interval_minutes, next_crawl_at)
      VALUES
        ($1, $2, 'PUBLISHED', true, 60, $3),
        ($1, $4, 'PUBLISHED', true, 60, null),
        ($5, $6, 'PUBLISHED', true, 60, $3)
    `, [organizationId, dueSourceId, new Date(now.getTime() - 60_000), recentSourceId, otherOrganizationId, foreignSourceId]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const first = await KnowledgeRecrawlService.claimDueForOrganization(organizationId, now);
      assert.deepEqual(first.map((item) => item.sourceId), [dueSourceId], "only the due website should be claimed");

      const second = await KnowledgeRecrawlService.claimDueForOrganization(organizationId, now);
      assert.equal(second.length, 0, "a due source must not be claimable twice after next_crawl_at advances");

      const [due] = await db.select().from(knowledgeSourceIntelligence).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, dueSourceId))).limit(1);
      assert.ok(due.nextCrawlAt && due.nextCrawlAt.getTime() === now.getTime() + 60 * 60_000, "claimed source must advance exactly one interval");

      const [recent] = await db.select().from(knowledgeSourceIntelligence).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, recentSourceId))).limit(1);
      assert.ok(recent.nextCrawlAt && recent.nextCrawlAt.getTime() === now.getTime() + 50 * 60_000, "legacy null schedule must initialize from last crawl without dispatching early");

      const visibleSources = await db.select({ id: knowledgeSources.id }).from(knowledgeSources);
      assert.equal(visibleSources.some((source) => source.id === foreignSourceId), false, "foreign source must remain hidden by RLS");
    });

    const foreign = await admin.query("SELECT next_crawl_at FROM knowledge_source_intelligence WHERE organization_id = $1 AND source_id = $2", [otherOrganizationId, foreignSourceId]);
    assert.equal(new Date(foreign.rows[0].next_crawl_at).getTime(), now.getTime() - 60_000, "another tenant's schedule must not be modified");

    console.log("Knowledge recrawl scheduling integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeQueues().catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
