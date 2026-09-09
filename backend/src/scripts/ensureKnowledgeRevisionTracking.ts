import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required to configure knowledge revision tracking");

async function main() {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const table of ["file_objects", "knowledge_sources", "knowledge_source_revisions"]) {
      const result = await client.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]);
      if (!result.rows[0]?.table_name) throw new Error(`Required table missing for knowledge revision tracking: ${table}`);
    }

    await client.query(`
      CREATE OR REPLACE FUNCTION public.supportai_track_processed_knowledge_revision()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = public
      AS $$
      DECLARE
        matched text[];
        parsed_source_id uuid;
        parsed_revision integer;
      BEGIN
        IF NEW.storage_class <> 'PROCESSED' OR NEW.status <> 'READY' THEN
          RETURN NEW;
        END IF;

        matched := regexp_match(
          NEW.storage_key,
          '^organizations/([0-9a-fA-F-]{36})/knowledge/([0-9a-fA-F-]{36})/revisions/([0-9]+)/processed/extracted\\.txt$'
        );
        IF matched IS NULL THEN
          RETURN NEW;
        END IF;

        IF matched[1]::uuid <> NEW.organization_id THEN
          RAISE EXCEPTION 'Processed knowledge object organization mismatch';
        END IF;

        parsed_source_id := matched[2]::uuid;
        parsed_revision := matched[3]::integer;

        IF NOT EXISTS (
          SELECT 1 FROM knowledge_sources ks
          WHERE ks.id = parsed_source_id
            AND ks.organization_id = NEW.organization_id
        ) THEN
          RAISE EXCEPTION 'Processed knowledge object source mismatch';
        END IF;

        INSERT INTO knowledge_source_revisions (
          organization_id,
          source_id,
          revision,
          processed_text_object_id,
          sha256,
          processing_status,
          security_status,
          created_at,
          updated_at
        )
        VALUES (
          NEW.organization_id,
          parsed_source_id,
          parsed_revision,
          NEW.id,
          NEW.sha256,
          'PROCESSING',
          'SAFE',
          now(),
          now()
        )
        ON CONFLICT (source_id, revision) DO UPDATE
        SET processed_text_object_id = EXCLUDED.processed_text_object_id,
            updated_at = now();

        RETURN NEW;
      END;
      $$;
    `);

    await client.query(`DROP TRIGGER IF EXISTS supportai_track_processed_knowledge_revision ON file_objects`);
    await client.query(`
      CREATE TRIGGER supportai_track_processed_knowledge_revision
      AFTER INSERT OR UPDATE OF status ON file_objects
      FOR EACH ROW
      EXECUTE FUNCTION public.supportai_track_processed_knowledge_revision()
    `);

    console.log("Verified processed knowledge revision tracking trigger.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
