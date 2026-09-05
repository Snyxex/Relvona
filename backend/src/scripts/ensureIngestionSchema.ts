import pg from "pg";

export const ingestionSchemaSql = `
CREATE TABLE IF NOT EXISTS public.knowledge_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamp,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  error_message text,
  started_at timestamp,
  finished_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_ingestion_jobs_source_id_unique ON public.knowledge_ingestion_jobs(source_id);
CREATE INDEX IF NOT EXISTS ingestion_pending_idx ON public.knowledge_ingestion_jobs(organization_id, status, next_attempt_at);
ALTER TABLE public.knowledge_ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_ingestion_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supportai_tenant_isolation ON public.knowledge_ingestion_jobs;
CREATE POLICY supportai_tenant_isolation ON public.knowledge_ingestion_jobs
USING (organization_id::text = current_setting('app.organization_id', true))
WITH CHECK (organization_id::text = current_setting('app.organization_id', true));
`;

async function main() {
  const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(ingestionSchemaSql);
    await client.query("COMMIT");
    console.log("Verified durable ingestion schema (additive migration).");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.end(); }
}

if (require.main === module) main().catch((error) => { console.error("Ingestion schema migration failed:", error); process.exitCode = 1; });
