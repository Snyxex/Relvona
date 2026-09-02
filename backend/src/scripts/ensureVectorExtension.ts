import pg from "pg";

const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is required to enable pgvector");

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("Verified pgvector extension.");
  } finally { await client.end(); }
}

main().catch((error) => { console.error("pgvector extension setup failed:", error); process.exitCode = 1; });
