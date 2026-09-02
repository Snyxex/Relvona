import pg from "pg";

const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is required to create pgvector indexes");

async function ensureVectorIndexes() {
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query("CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx ON document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE embedding IS NOT NULL");
    console.log("Verified pgvector HNSW index for document chunks.");
  } finally {
    await pool.end();
  }
}

ensureVectorIndexes().catch((error) => { console.error("pgvector index setup failed:", error); process.exit(1); });
