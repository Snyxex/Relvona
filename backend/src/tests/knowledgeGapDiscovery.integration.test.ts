import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool, db } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { knowledgeGaps, knowledgeGapSignals } from "../db/supportAnalyticsSchema.js";
import { eq } from "drizzle-orm";
import { KnowledgeGapDiscoveryService } from "../services/knowledgeGapDiscoveryService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for knowledge gap discovery integration tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const customerId = randomUUID();
const conversationId = randomUUID();
const customerMessageId = randomUUID();
const aiMessageId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'Gap Test', $2, $3), ($4, 'Other Gap Test', $5, $6)",
      [organizationId, `gap-${organizationId}`, `gap-key-${organizationId}`, otherOrganizationId, `gap-${otherOrganizationId}`, `gap-key-${otherOrganizationId}`],
    );
    await admin.query("INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'gap@example.test', 'Gap Customer')", [customerId, organizationId]);
    await admin.query("INSERT INTO conversations (id, organization_id, customer_id, state) VALUES ($1, $2, $3, 'AI_ACTIVE')", [conversationId, organizationId, customerId]);
    const now = Date.now();
    await admin.query(
      "INSERT INTO conversation_messages (id, conversation_id, organization_id, sender_type, content, created_at) VALUES ($1, $3, $4, 'customer', $5, $6), ($2, $3, $4, 'ai', 'Unzureichende Antwort', $7)",
      [customerMessageId, aiMessageId, conversationId, organizationId, "Wie richte ich SSO für max@example.test ein?", new Date(now), new Date(now + 1000)],
    );
    await admin.query(
      "INSERT INTO message_feedback (organization_id, conversation_id, message_id, rating, reason) VALUES ($1, $2, $3, -1, 'Die Dokumentation fehlt')",
      [organizationId, conversationId, aiMessageId],
    );

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      const first = await KnowledgeGapDiscoveryService.discoverFromNegativeFeedback(organizationId, 20);
      assert.equal(first.processed, 1);
      assert.equal(first.skipped, 0);

      const second = await KnowledgeGapDiscoveryService.discoverFromNegativeFeedback(organizationId, 20);
      assert.equal(second.processed, 0, "same feedback must not be processed twice");
      assert.equal(second.skipped, 1);

      const gaps = await db.select().from(knowledgeGaps).where(eq(knowledgeGaps.organizationId, organizationId));
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].occurrences, 1, "re-running discovery must not inflate occurrences");
      assert.doesNotMatch(gaps[0].summary, /max@example\.test/i, "PII must be redacted before knowledge gap persistence");

      const signals = await db.select().from(knowledgeGapSignals).where(eq(knowledgeGapSignals.organizationId, organizationId));
      assert.equal(signals.length, 1);
      assert.equal(signals[0].gapId, gaps[0].id);
    });

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(otherOrganizationId);
      const foreignGaps = await db.select().from(knowledgeGaps);
      const foreignSignals = await db.select().from(knowledgeGapSignals);
      assert.equal(foreignGaps.length, 0, "knowledge gaps must be tenant isolated");
      assert.equal(foreignSignals.length, 0, "knowledge gap signals must be tenant isolated");
    });

    console.log("Knowledge gap discovery integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationId, otherOrganizationId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
