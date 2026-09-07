import "dotenv/config";
import pg from "pg";

const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required to normalize embedding configuration");

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      UPDATE assistants
      SET embedding_provider = 'openai',
          embedding_model = 'text-embedding-3-small',
          embedding_base_url = NULL,
          updated_at = NOW()
      WHERE embedding_provider IS DISTINCT FROM 'openai'
         OR embedding_model IS DISTINCT FROM 'text-embedding-3-small'
         OR embedding_base_url IS NOT NULL
    `);
    console.log(`Normalized ${result.rowCount || 0} assistant embedding configuration(s) to the shared 1536-dimensional OpenAI index.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
