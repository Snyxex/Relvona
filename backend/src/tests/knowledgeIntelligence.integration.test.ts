import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { knowledgeBases, knowledgeSources } from "../db/schema.js";
import { knowledgeFaqDrafts, knowledgeSourceIntelligence } from "../db/supportAnalyticsSchema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { KnowledgeIntelligenceService } from "../services/knowledgeIntelligenceService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for knowledge intelligence integration tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const knowledgeBaseId = randomUUID();
const sourceId = randomUUID();
const otherKnowledgeBaseId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Knowledge Intelligence', $2), ($3, 'Other Knowledge Intelligence', $4)", [organizationId, `ki-${organizationId}`, otherOrganizationId, `ki-${otherOrganizationId}`]);
    await admin.query("INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'Primary'), ($3, $4, 'Other')", [knowledgeBaseId, organizationId, otherKnowledgeBaseId, otherOrganizationId]);
    await admin.query("INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type, status, chunk_count, current_revision) VALUES ($1, $2, $3, 'Broken Source', 'document', 'failed', 0, 0)", [sourceId, organizationId, knowledgeBaseId]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const record = await KnowledgeIntelligenceService.ensureSourceRecord(organizationId, sourceId);
      assert.equal(record.organizationId, organizationId);

      const health = await KnowledgeIntelligenceService.recomputeSourceHealth(organizationId, sourceId);
      assert.equal(health.health, "PROCESSING_FAILED");

      const overview = await KnowledgeIntelligenceService.getHealthOverview(organizationId, knowledgeBaseId);
      assert.equal(overview.totalSources, 1);
      assert.equal(overview.counts.PROCESSING_FAILED, 1);
      assert.ok(overview.score < 100);

      const settings = await KnowledgeIntelligenceService.updateSourceSettings(organizationId, sourceId, { publicationStatus: "DRAFT", priority: "AUTHORITATIVE", category: "technical", tags: ["sso", "security"] });
      assert.equal(settings.publicationStatus, "DRAFT");
      assert.equal(settings.priority, "AUTHORITATIVE");

      const draft = await KnowledgeIntelligenceService.createFaqDraft({ organizationId, knowledgeBaseId, question: "How is SSO configured?", answer: "Follow the reviewed tenant SSO procedure.", createdByUserId: randomUUID(), evidence: [{ sourceId }] });
      assert.equal(draft.reviewStatus, "PENDING_REVIEW");
      const approved = await KnowledgeIntelligenceService.reviewFaqDraft(organizationId, draft.id, "APPROVED", randomUUID());
      assert.equal(approved.reviewStatus, "APPROVED");
      const published = await KnowledgeIntelligenceService.publishFaqDraft(organizationId, draft.id, randomUUID());
      assert.equal(published.reviewStatus, "PUBLISHED");
      assert.ok(published.publishedSourceId);

      const [publishedSource] = await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, organizationId), eq(knowledgeSources.id, published.publishedSourceId!))).limit(1);
      assert.equal(publishedSource.type, "faq");
      const [publishedIntelligence] = await db.select().from(knowledgeSourceIntelligence).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, publishedSource.id))).limit(1);
      assert.equal(publishedIntelligence.publicationStatus, "DRAFT", "reviewed FAQ must not bypass ingestion/publish readiness");
    });

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(otherOrganizationId);
      const foreignIntelligence = await db.select().from(knowledgeSourceIntelligence);
      const foreignDrafts = await db.select().from(knowledgeFaqDrafts);
      assert.equal(foreignIntelligence.length, 0, "source intelligence must be tenant isolated by RLS");
      assert.equal(foreignDrafts.length, 0, "FAQ drafts must be tenant isolated by RLS");
      await assert.rejects(() => KnowledgeIntelligenceService.ensureSourceRecord(otherOrganizationId, sourceId), /Knowledge source not found/);
    });

    console.log("Knowledge intelligence integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
