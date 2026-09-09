import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool, db } from "../db/index.js";
import { assistantKnowledgeCollections, knowledgeCollections, sourceKnowledgeCollections } from "../db/knowledgeCollectionsSchema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { KnowledgeCollectionService } from "../services/knowledgeCollectionService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for knowledge collection tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const knowledgeBaseId = randomUUID();
const otherKnowledgeBaseId = randomUUID();
const sourceId = randomUUID();
const otherSourceId = randomUUID();
const assistantId = randomUUID();
const otherAssistantId = randomUUID();
const foreignCollectionId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Collections A', $2), ($3, 'Collections B', $4)", [organizationId, `collections-${organizationId}`, otherOrganizationId, `collections-${otherOrganizationId}`]);
    await admin.query("INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'A'), ($3, $4, 'B')", [knowledgeBaseId, organizationId, otherKnowledgeBaseId, otherOrganizationId]);
    await admin.query("INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type, status, security_status) VALUES ($1, $2, $3, 'A source', 'document', 'completed', 'SAFE'), ($4, $5, $6, 'B source', 'document', 'completed', 'SAFE')", [sourceId, organizationId, knowledgeBaseId, otherSourceId, otherOrganizationId, otherKnowledgeBaseId]);
    await admin.query("INSERT INTO assistants (id, organization_id, name) VALUES ($1, $2, 'Assistant A'), ($3, $4, 'Assistant B')", [assistantId, organizationId, otherAssistantId, otherOrganizationId]);
    await admin.query("INSERT INTO knowledge_collections (id, organization_id, name) VALUES ($1, $2, 'Foreign')", [foreignCollectionId, otherOrganizationId]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const created = await KnowledgeCollectionService.create(organizationId, { name: "Billing", description: "Billing knowledge" });
      assert.equal(created.organizationId, organizationId);

      const sourceAssignment = await KnowledgeCollectionService.setSourceCollections(organizationId, sourceId, [created.id]);
      assert.deepEqual(sourceAssignment.collectionIds, [created.id]);

      const assistantAssignment = await KnowledgeCollectionService.setAssistantCollections(organizationId, assistantId, [created.id]);
      assert.equal(assistantAssignment.unrestricted, false);
      const scope = await KnowledgeCollectionService.getAssistantScope(organizationId, assistantId);
      assert.equal(scope.unrestricted, false);
      assert.deepEqual(scope.collections.map((row) => row.collectionId), [created.id]);

      const listed = await KnowledgeCollectionService.list(organizationId);
      const listedBilling = listed.find((collection) => collection.id === created.id);
      assert.ok(listedBilling, "created collection must be listed");
      assert.deepEqual(listedBilling.sourceIds, [sourceId], "list response must expose tenant-local source assignments for the admin UI");
      assert.deepEqual(listedBilling.assistantIds, [assistantId], "list response must expose tenant-local assistant assignments for the admin UI");
      assert.equal(listedBilling.sourceCount, 1);
      assert.equal(listedBilling.assistantCount, 1);

      await assert.rejects(() => KnowledgeCollectionService.setSourceCollections(organizationId, sourceId, [foreignCollectionId]), /not found/);
      await assert.rejects(() => KnowledgeCollectionService.setAssistantCollections(organizationId, assistantId, [foreignCollectionId]), /not found/);

      const visibleCollections = await db.select().from(knowledgeCollections);
      assert.equal(visibleCollections.some((row) => row.id === foreignCollectionId), false, "foreign collections must be hidden by RLS");
      assert.equal((await db.select().from(sourceKnowledgeCollections)).length, 1);
      assert.equal((await db.select().from(assistantKnowledgeCollections)).length, 1);

      const unrestricted = await KnowledgeCollectionService.setAssistantCollections(organizationId, assistantId, []);
      assert.equal(unrestricted.unrestricted, true, "empty assistant scope preserves legacy unrestricted retrieval semantics");
    });

    const foreignLinks = await admin.query("SELECT count(*)::int AS count FROM source_knowledge_collections WHERE organization_id = $1", [otherOrganizationId]);
    assert.equal(foreignLinks.rows[0].count, 0, "tenant A must never create links in tenant B");
    console.log("Knowledge collections integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
