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
ALTER TABLE public.knowledge_sources ADD COLUMN IF NOT EXISTS current_revision integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.file_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE, storage_class text NOT NULL, original_filename text NOT NULL, mime_type text NOT NULL,
  file_size integer NOT NULL, sha256 text NOT NULL, status text NOT NULL DEFAULT 'PENDING_UPLOAD', metadata jsonb,
  checksum_verified_at timestamp, expires_at timestamp, deleted_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE public.file_objects ADD COLUMN IF NOT EXISTS expires_at timestamp;
CREATE INDEX IF NOT EXISTS file_objects_org_hash_idx ON public.file_objects(organization_id, sha256);
CREATE INDEX IF NOT EXISTS file_objects_cleanup_idx ON public.file_objects(organization_id, status, expires_at);
CREATE TABLE IF NOT EXISTS public.knowledge_source_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE, revision integer NOT NULL,
  raw_object_id uuid REFERENCES public.file_objects(id) ON DELETE RESTRICT, processed_text_object_id uuid REFERENCES public.file_objects(id) ON DELETE RESTRICT,
  sha256 text, processing_status text NOT NULL DEFAULT 'QUEUED', security_status text NOT NULL DEFAULT 'SAFE',
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), UNIQUE(source_id, revision)
);
CREATE INDEX IF NOT EXISTS knowledge_source_revisions_org_source_idx ON public.knowledge_source_revisions(organization_id, source_id);
CREATE TABLE IF NOT EXISTS public.file_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, file_object_id uuid NOT NULL REFERENCES public.file_objects(id) ON DELETE RESTRICT,
 conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE, ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE, uploader_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL, uploader_type text NOT NULL, created_at timestamp NOT NULL DEFAULT now(),
 CHECK ((conversation_id IS NOT NULL)::int + (ticket_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS file_attachment_object_unique ON public.file_attachments(file_object_id);
CREATE INDEX IF NOT EXISTS file_attachments_org_idx ON public.file_attachments(organization_id, conversation_id, ticket_id);
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS conversation_message_id uuid REFERENCES public.conversation_messages(id) ON DELETE SET NULL;
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS ticket_comment_id uuid REFERENCES public.ticket_comments(id) ON DELETE SET NULL;
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'INTERNAL_ONLY';
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS original_filename text NOT NULL DEFAULT '';
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS file_size integer NOT NULL DEFAULT 0;
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'READY';
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE public.file_attachments ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, file_object_id uuid REFERENCES public.file_objects(id) ON DELETE RESTRICT,
 export_type text NOT NULL, status text NOT NULL DEFAULT 'PENDING', expires_at timestamp, created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exports_org_idx ON public.exports(organization_id, status, expires_at);
ALTER TABLE public.knowledge_ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_ingestion_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supportai_tenant_isolation ON public.knowledge_ingestion_jobs;
CREATE POLICY supportai_tenant_isolation ON public.knowledge_ingestion_jobs
USING (organization_id::text = current_setting('app.organization_id', true))
WITH CHECK (organization_id::text = current_setting('app.organization_id', true));
ALTER TABLE public.file_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_objects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supportai_tenant_isolation ON public.file_objects;
CREATE POLICY supportai_tenant_isolation ON public.file_objects USING (organization_id::text = current_setting('app.organization_id', true)) WITH CHECK (organization_id::text = current_setting('app.organization_id', true));
ALTER TABLE public.knowledge_source_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_source_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supportai_tenant_isolation ON public.knowledge_source_revisions;
CREATE POLICY supportai_tenant_isolation ON public.knowledge_source_revisions USING (organization_id::text = current_setting('app.organization_id', true)) WITH CHECK (organization_id::text = current_setting('app.organization_id', true));
ALTER TABLE public.file_attachments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.file_attachments FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS supportai_tenant_isolation ON public.file_attachments; CREATE POLICY supportai_tenant_isolation ON public.file_attachments USING (organization_id::text = current_setting('app.organization_id', true)) WITH CHECK (organization_id::text = current_setting('app.organization_id', true));
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY; ALTER TABLE public.exports FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS supportai_tenant_isolation ON public.exports; CREATE POLICY supportai_tenant_isolation ON public.exports USING (organization_id::text = current_setting('app.organization_id', true)) WITH CHECK (organization_id::text = current_setting('app.organization_id', true));
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
