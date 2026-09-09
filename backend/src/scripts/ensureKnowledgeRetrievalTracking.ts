import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required to configure knowledge retrieval tracking");

async function main() {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const required = ["conversation_messages", "document_chunks", "knowledge_source_intelligence", "knowledge_retrieval_events"];
    for (const table of required) {
      const result = await client.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]);
      if (!result.rows[0]?.table_name) throw new Error(`Required table missing for retrieval tracking: ${table}`);
    }

    await client.query(`
      CREATE OR REPLACE FUNCTION public.supportai_track_committed_retrieval()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = public
      AS $$
      BEGIN
        IF NEW.sender_type <> 'ai'
          OR NEW.retrieved_chunk_ids IS NULL
          OR jsonb_typeof(NEW.retrieved_chunk_ids) <> 'array'
          OR jsonb_array_length(NEW.retrieved_chunk_ids) = 0 THEN
          RETURN NEW;
        END IF;

        INSERT INTO knowledge_source_intelligence (organization_id, source_id, publication_status, health, priority, created_at, updated_at)
        SELECT DISTINCT NEW.organization_id, dc.source_id, 'PUBLISHED', 'HEALTHY', 'NORMAL', now(), now()
        FROM jsonb_array_elements_text(NEW.retrieved_chunk_ids) AS ids(chunk_id)
        JOIN document_chunks dc
          ON dc.id::text = ids.chunk_id
         AND dc.organization_id = NEW.organization_id
        ON CONFLICT (source_id) DO NOTHING;

        INSERT INTO knowledge_retrieval_events (
          organization_id,
          conversation_id,
          source_id,
          chunk_id,
          used_in_final_answer,
          created_at
        )
        SELECT DISTINCT NEW.organization_id, NEW.conversation_id, dc.source_id, dc.id, true, NEW.created_at
        FROM jsonb_array_elements_text(NEW.retrieved_chunk_ids) AS ids(chunk_id)
        JOIN document_chunks dc
          ON dc.id::text = ids.chunk_id
         AND dc.organization_id = NEW.organization_id;

        WITH per_source AS (
          SELECT dc.source_id, count(DISTINCT dc.id)::int AS retrieved_chunks
          FROM jsonb_array_elements_text(NEW.retrieved_chunk_ids) AS ids(chunk_id)
          JOIN document_chunks dc
            ON dc.id::text = ids.chunk_id
           AND dc.organization_id = NEW.organization_id
          GROUP BY dc.source_id
        )
        UPDATE knowledge_source_intelligence ksi
        SET retrieval_count = ksi.retrieval_count + per_source.retrieved_chunks,
            answer_usage_count = ksi.answer_usage_count + 1,
            last_retrieved_at = NEW.created_at,
            last_used_in_answer_at = NEW.created_at,
            updated_at = now()
        FROM per_source
        WHERE ksi.organization_id = NEW.organization_id
          AND ksi.source_id = per_source.source_id;

        RETURN NEW;
      END;
      $$;
    `);

    await client.query(`DROP TRIGGER IF EXISTS supportai_track_committed_retrieval ON conversation_messages`);
    await client.query(`
      CREATE TRIGGER supportai_track_committed_retrieval
      AFTER INSERT ON conversation_messages
      FOR EACH ROW
      EXECUTE FUNCTION public.supportai_track_committed_retrieval()
    `);

    console.log("Verified committed AI-message retrieval tracking trigger.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
