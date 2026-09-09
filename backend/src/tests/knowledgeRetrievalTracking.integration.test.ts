import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, db } from "../db/index.js";
import { conversationMessages, conversations, customers, documentChunks, knowledgeBases, knowledgeSources } from "../db/schema.js";
import { knowledgeRetrievalEvents, knowledgeSourceIntelligence } from "../db/supportAnalyticsSchema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for knowledge retrieval tracking tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const knowledgeBaseId = randomUUID();
const sourceId = randomUUID();
const chunkId = randomUUID();
const customerId = randomUUID();
const otherCustomerId = randomUUID();
const conversationId = randomUUID();
const otherConversationId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Retrieval Tracking', $2), ($3, 'Retrieval Tracking Other', $4)", [organizationId, `rt-${organizationId}`, otherOrganizationId, `rt-${otherOrganizationId}`]);
    await admin.query("INSERT INTO customers (id, organization_id, name) VALUES ($1, $2, 'Customer A'), ($3, $4, 'Customer B')", [customerId, organizationId, otherCustomerId, otherOrganizationId]);
    await admin.query("INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'Primary')", [knowledgeBaseId, organizationId]);
    await admin.query("INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type, status, security_status, chunk_count, current_revision) VALUES ($1, $2, $3, 'Tracked Source', 'document', 'completed', 'SAFE', 1, 1)", [sourceId, organizationId, knowledgeBaseId]);
    await admin.query("INSERT INTO document_chunks (id, organization_id, knowledge_base_id, source_id, chunk_index, content) VALUES ($1, $2, $3, $4, 0, 'Tracked knowledge')", [chunkId, organizationId, knowledgeBaseId, sourceId]);
    await admin.query("INSERT INTO conversations (id, organization_id, customer_id, state) VALUES ($1, $2, $3, 'AI_ACTIVE'), ($4, $5, $6, 'AI_ACTIVE')", [conversationId, organizationId, customerId, otherConversationId, otherOrganizationId, otherCustomerId]);

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await db.insert(conversationMessages).values({
        conversationId,
        organizationId,
        senderType: "ai",
        content: "Answer grounded in the tracked source.",
        retrievedChunkIds: [chunkId, chunkId],
      });

      const events = await db.select().from(knowledgeRetrievalEvents).where(and(eq(knowledgeRetrievalEvents.organizationId, organizationId), eq(knowledgeRetrievalEvents.chunkId, chunkId)));
      assert.equal(events.length, 1, "duplicate chunk ids on one committed AI message must be counted once");
      assert.equal(events[0].usedInFinalAnswer, true);
      assert.equal(events[0].conversationId, conversationId);

      const [intelligence] = await db.select().from(knowledgeSourceIntelligence).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, sourceId))).limit(1);
      assert.ok(intelligence, "committed retrieval must create source intelligence metadata when missing");
      assert.equal(intelligence.retrievalCount, 1);
      assert.equal(intelligence.answerUsageCount, 1);
      assert.equal(intelligence.publicationStatus, "PUBLISHED");

      await db.insert(conversationMessages).values({
        conversationId,
        organizationId,
        senderType: "agent",
        content: "Agent reply should not count as AI retrieval.",
        retrievedChunkIds: [chunkId],
      });
      const [unchanged] = await db.select().from(knowledgeSourceIntelligence).where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, sourceId))).limit(1);
      assert.equal(unchanged.retrievalCount, 1);
      assert.equal(unchanged.answerUsageCount, 1);
    });

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(otherOrganizationId);
      await db.insert(conversationMessages).values({
        conversationId: otherConversationId,
        organizationId: otherOrganizationId,
        senderType: "ai",
        content: "Foreign chunk id must never be attributed.",
        retrievedChunkIds: [chunkId],
      });
      const events = await db.select().from(knowledgeRetrievalEvents);
      assert.equal(events.length, 0, "foreign tenant chunk ids must not create retrieval events");
      const intelligence = await db.select().from(knowledgeSourceIntelligence);
      assert.equal(intelligence.length, 0, "foreign tenant chunk ids must not create intelligence records");
    });

    console.log("Knowledge retrieval tracking integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
