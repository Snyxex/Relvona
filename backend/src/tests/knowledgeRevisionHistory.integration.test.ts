import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool, db } from "../db/index.js";
import { fileObjects, knowledgeSourceRevisions } from "../db/schema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { KnowledgeRevisionService } from "../services/knowledgeRevisionService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for knowledge revision history tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const knowledgeBaseId = randomUUID();
const otherKnowledgeBaseId = randomUUID();
const sourceId = randomUUID();
const otherSourceId = randomUUID();
const processedObjectId = randomUUID();
const foreignProcessedObjectId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Revision A', $2), ($3, 'Revision B', $4)", [organizationId, `revision-${organizationId}`, otherOrganizationId, `revision-${otherOrganizationId}`]);
    await admin.query("INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'A'), ($3, $4, 'B')", [knowledgeBaseId, organizationId, otherKnowledgeBaseId, otherOrganizationId]);
    await admin.query("INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type, status, security_status, current_revision) VALUES ($1, $2, $3, 'Website A', 'website', 'completed', 'SAFE', 2), ($4, $5, $6, 'Website B', 'website', 'completed', 'SAFE', 1)", [sourceId, organizationId, knowledgeBaseId, otherSourceId, otherOrganizationId, otherKnowledgeBaseId]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await db.insert(fileObjects).values({
        id: processedObjectId,
        organizationId,
        storageKey: `organizations/${organizationId}/knowledge/${sourceId}/revisions/2/processed/extracted.txt`,
        storageClass: "PROCESSED",
        originalFilename: "extracted.txt",
        mimeType: "text/plain",
        fileSize: 128,
        sha256: "a".repeat(64),
        status: "READY",
        checksumVerifiedAt: new Date(),
      });

      const revisions = await db.select().from(knowledgeSourceRevisions);
      assert.equal(revisions.length, 1, "READY processed artifact must create a revision record");
      assert.equal(revisions[0].sourceId, sourceId);
      assert.equal(revisions[0].revision, 2);
      assert.equal(revisions[0].processedTextObjectId, processedObjectId);
      assert.equal(revisions[0].processingStatus, "PROCESSING");

      await db.update(knowledgeSourceRevisions).set({ processingStatus: "READY", securityStatus: "SAFE", updatedAt: new Date() });
      const history = await KnowledgeRevisionService.list(organizationId, sourceId, 20);
      assert.equal(history.currentRevision, 2);
      assert.equal(history.items.length, 1);
      assert.equal(history.items[0].active, true);
      assert.equal(history.items[0].processedSize, 128);
    });

    await admin.query("INSERT INTO file_objects (id, organization_id, storage_key, storage_class, original_filename, mime_type, file_size, sha256, status) VALUES ($1, $2, $3, 'PROCESSED', 'extracted.txt', 'text/plain', 64, $4, 'READY')", [foreignProcessedObjectId, otherOrganizationId, `organizations/${otherOrganizationId}/knowledge/${otherSourceId}/revisions/1/processed/extracted.txt`, "b".repeat(64)]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const history = await KnowledgeRevisionService.list(organizationId, sourceId, 20);
      assert.equal(history.items.every((row) => row.id !== foreignProcessedObjectId), true);
      await assert.rejects(() => KnowledgeRevisionService.list(organizationId, otherSourceId, 20), /not found/);
    });

    console.log("Knowledge revision history integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
