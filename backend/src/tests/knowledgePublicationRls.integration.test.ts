import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { documentChunks, knowledgeBases, knowledgeSources } from "../db/schema.js";
import { knowledgeSourceIntelligence } from "../db/supportAnalyticsSchema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for knowledge publication RLS integration tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const knowledgeBaseId = randomUUID();
const sourceId = randomUUID();
const chunkId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function visibleChunkCount() {
  const rows = await db.select({ id: documentChunks.id }).from(documentChunks).where(and(eq(documentChunks.organizationId, organizationId), eq(documentChunks.sourceId, sourceId)));
  return rows.length;
}

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Knowledge Publication RLS', $2), ($3, 'Knowledge Publication Other', $4)", [organizationId, `kp-${organizationId}`, otherOrganizationId, `kp-${otherOrganizationId}`]);
    await admin.query("INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'Primary')", [knowledgeBaseId, organizationId]);
    await admin.query("INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type, status, security_status, chunk_count, current_revision) VALUES ($1, $2, $3, 'Publication Source', 'document', 'completed', 'SAFE', 1, 1)", [sourceId, organizationId, knowledgeBaseId]);
    await admin.query("INSERT INTO document_chunks (id, organization_id, knowledge_base_id, source_id, chunk_index, content) VALUES ($1, $2, $3, $4, 0, 'Published knowledge')", [chunkId, organizationId, knowledgeBaseId, sourceId]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      assert.equal(await visibleChunkCount(), 1, "legacy sources without intelligence metadata must remain readable during additive rollout");

      await db.insert(knowledgeSourceIntelligence).values({ organizationId, sourceId, publicationStatus: "PUBLISHED" });
      assert.equal(await visibleChunkCount(), 1, "published source chunks must be readable");

      await db.update(knowledgeSourceIntelligence).set({ publicationStatus: "DRAFT", updatedAt: new Date() }).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, sourceId)));
      assert.equal(await visibleChunkCount(), 0, "draft source chunks must be hidden from the restricted application role");

      await db.update(knowledgeSourceIntelligence).set({ publicationStatus: "PUBLISHED", updatedAt: new Date() }).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, sourceId)));
      assert.equal(await visibleChunkCount(), 1, "republished source chunks must become readable again");

      await db.update(knowledgeSourceIntelligence).set({ publicationStatus: "ARCHIVED", updatedAt: new Date() }).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, sourceId)));
      assert.equal(await visibleChunkCount(), 0, "archived source chunks must be hidden immediately");
    });

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(otherOrganizationId);
      assert.equal(await visibleChunkCount(), 0, "publication policy must retain cross-tenant isolation");
    });

    console.log("Knowledge publication RLS integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
