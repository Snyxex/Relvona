import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, withTenantTransaction } from "../db/index.js";
import { knowledgeBases, knowledgeSources, knowledgeIngestionJobs as jobs, documentChunks } from "../db/schema.js";
import { IngestionJobService } from "../services/ingestionJobService.js";
import type { PreparedSource } from "../services/ingestionService.js";

async function main() {
  if (!process.env.DATABASE_ADMIN_URL || !process.env.DATABASE_URL) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL (non-owner application role) are required");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const tenantA = randomUUID(); const tenantB = randomUUID();
  await admin.connect(); await app.connect();
  const result = (content: string): PreparedSource => ({ title: "Test", contentHash: content, securityStatus: "SAFE", pages: [], chunks: [{ content, embedding: Array(1536).fill(0.01), metadata: {} }] });
  try {
    const role = await app.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    assert.equal(role.rows[0].rolsuper || role.rows[0].rolbypassrls, false, "Tests must use an RLS-constrained app role");
    await admin.query(
      "INSERT INTO organizations(id, name, slug) VALUES ($1::uuid, 'Ingestion Test A', $2::text), ($3::uuid, 'Ingestion Test B', $4::text)",
      [tenantA, `ingestion-test-a-${tenantA}`, tenantB, `ingestion-test-b-${tenantB}`],
    );
    const [baseA] = await withTenantTransaction(tenantA, (tx) => tx.insert(knowledgeBases).values({ organizationId: tenantA, name: "Ingestion fixture" }).returning());
    const input = { type: "document" as const, title: "Test", knowledgeBaseId: baseA.id, content: "Original document" };
    await assert.rejects(IngestionJobService.submit(tenantB, input), /Knowledge base not found/);
    const first = await IngestionJobService.submit(tenantA, input);
    assert.equal((await withTenantTransaction(tenantB, (tx) => tx.select().from(jobs).where(eq(jobs.id, first.jobId)))).length, 0, "Foreign jobs and payloads must be invisible");
    assert.ok((await IngestionJobService.pending(tenantA)).some((job) => job.jobId === first.jobId), "A DB submission remains dispatchable without Redis");
    await IngestionJobService.process(first, async () => result("first version"));
    await IngestionJobService.process(first, async () => { throw new Error("Replay must not call provider"); });
    assert.equal((await withTenantTransaction(tenantA, (tx) => tx.select().from(documentChunks).where(eq(documentChunks.sourceId, first.sourceId)))).length, 1, "Replay must not duplicate chunks");

    const second = await IngestionJobService.submit(tenantA, input, first.sourceId);
    let release!: () => void; let started!: () => void;
    const reachedProvider = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const oldWorker = IngestionJobService.process(second, async () => { started(); await gate; return result("obsolete version"); });
    await reachedProvider;
    const third = await IngestionJobService.submit(tenantA, { ...input, content: "Edited" }, first.sourceId);
    await IngestionJobService.process(third, async () => result("latest version"));
    release(); await oldWorker;
    const chunks = await withTenantTransaction(tenantA, (tx) => tx.select().from(documentChunks).where(eq(documentChunks.sourceId, first.sourceId)));
    assert.deepEqual(chunks.map((chunk) => chunk.content), ["latest version"], "A superseded worker cannot overwrite newer chunks");
    assert.equal((await withTenantTransaction(tenantA, (tx) => tx.select().from(knowledgeSources).where(eq(knowledgeSources.knowledgeBaseId, baseA.id)))).length, 1);

    const bad = await IngestionJobService.submit(tenantA, input, first.sourceId);
    for (let attempt = 0; attempt < 3; attempt++) {
      await withTenantTransaction(tenantA, (tx) => tx.update(jobs).set({ nextAttemptAt: new Date(0) }).where(eq(jobs.id, bad.jobId)));
      await IngestionJobService.process({ ...bad, attempt }, async () => { throw new Error("provider rejected test"); });
    }
    const [failed] = await withTenantTransaction(tenantA, (tx) => tx.select().from(jobs).where(eq(jobs.id, bad.jobId)));
    assert.equal(failed.status, "failed"); assert.equal(failed.attempts, 3);
    assert.equal((await IngestionJobService.pending(tenantA)).length, 0, "Exhausted jobs must not loop forever");

    const deleting = await IngestionJobService.submit(tenantA, input, first.sourceId);
    const duringDelete = IngestionJobService.process(deleting, async () => {
      await withTenantTransaction(tenantA, (tx) => tx.delete(knowledgeSources).where(and(eq(knowledgeSources.id, first.sourceId), eq(knowledgeSources.organizationId, tenantA))));
      return result("cannot resurrect");
    });
    await duringDelete;
    assert.equal((await withTenantTransaction(tenantA, (tx) => tx.select().from(documentChunks).where(eq(documentChunks.sourceId, first.sourceId)))).length, 0);
    assert.equal((await withTenantTransaction(tenantA, (tx) => tx.select().from(jobs).where(eq(jobs.id, deleting.jobId)))).length, 0);
    console.log("Ingestion database integration tests passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[tenantA, tenantB]]);
    await Promise.all([app.end(), admin.end(), closeDatabasePool()]);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
