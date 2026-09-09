import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { assistants, knowledgeSources } from "../db/schema.js";
import { assistantKnowledgeCollections, knowledgeCollections, sourceKnowledgeCollections } from "../db/knowledgeCollectionsSchema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { assistantKnowledgeScopePredicate } from "../services/knowledgeCollectionScope.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for assistant knowledge scope tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const knowledgeBaseId = randomUUID();
const otherKnowledgeBaseId = randomUUID();
const assistantId = randomUUID();
const sourceAId = randomUUID();
const sourceBId = randomUUID();
const unassignedSourceId = randomUUID();
const collectionAId = randomUUID();
const collectionBId = randomUUID();
const foreignCollectionId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function visibleSourceIds() {
  const rows = await db.select({ id: knowledgeSources.id }).from(knowledgeSources)
    .where(and(
      eq(knowledgeSources.organizationId, organizationId),
      assistantKnowledgeScopePredicate(organizationId, assistantId, knowledgeSources.id),
    ));
  return rows.map((row) => row.id).sort();
}

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Scope A', $2), ($3, 'Scope B', $4)", [organizationId, `scope-${organizationId}`, otherOrganizationId, `scope-${otherOrganizationId}`]);
    await admin.query("INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'A'), ($3, $4, 'B')", [knowledgeBaseId, organizationId, otherKnowledgeBaseId, otherOrganizationId]);
    await admin.query("INSERT INTO assistants (id, organization_id, name) VALUES ($1, $2, 'Scoped Assistant')", [assistantId, organizationId]);
    await admin.query(`
      INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type, status, security_status)
      VALUES
        ($1, $2, $3, 'Source A', 'document', 'completed', 'SAFE'),
        ($4, $2, $3, 'Source B', 'document', 'completed', 'SAFE'),
        ($5, $2, $3, 'Unassigned', 'document', 'completed', 'SAFE')
    `, [sourceAId, organizationId, knowledgeBaseId, sourceBId, unassignedSourceId]);
    await admin.query(`
      INSERT INTO knowledge_collections (id, organization_id, name)
      VALUES ($1, $2, 'Collection A'), ($3, $2, 'Collection B'), ($4, $5, 'Foreign')
    `, [collectionAId, organizationId, collectionBId, foreignCollectionId, otherOrganizationId]);
    await admin.query(`
      INSERT INTO source_knowledge_collections (organization_id, source_id, collection_id)
      VALUES ($1, $2, $3), ($1, $4, $5)
    `, [organizationId, sourceAId, collectionAId, sourceBId, collectionBId]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);

      assert.deepEqual(await visibleSourceIds(), [sourceAId, sourceBId, unassignedSourceId].sort(), "assistant without assignments must preserve unrestricted legacy retrieval");

      await db.insert(assistantKnowledgeCollections).values({ organizationId, assistantId, collectionId: collectionAId });
      assert.deepEqual(await visibleSourceIds(), [sourceAId], "scoped assistant must see only sources in an allowed collection; unassigned sources must be excluded");

      await db.insert(assistantKnowledgeCollections).values({ organizationId, assistantId, collectionId: collectionBId });
      assert.deepEqual(await visibleSourceIds(), [sourceAId, sourceBId].sort(), "multiple allowed collections must be combined");

      const foreignCollections = await db.select().from(knowledgeCollections).where(eq(knowledgeCollections.id, foreignCollectionId));
      assert.equal(foreignCollections.length, 0, "foreign collections must remain hidden by RLS");

      const links = await db.select().from(sourceKnowledgeCollections);
      assert.equal(links.every((link) => link.organizationId === organizationId), true, "scope evaluation must remain tenant-local");
    });

    console.log("Assistant knowledge scope integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
