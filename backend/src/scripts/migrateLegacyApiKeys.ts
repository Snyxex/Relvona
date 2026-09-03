import crypto from "crypto";
import pg from "pg";

// Converts the former organizations.api_key plaintext storage into the hashed
// api_keys representation. It is deliberately idempotent and runs with the
// migration/admin connection, before application RLS is enabled.
const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; api_key: string | null }>("SELECT id, api_key FROM organizations WHERE api_key IS NOT NULL");
    for (const org of rows) {
      if (!org.api_key) continue;
      const keyPrefix = org.api_key.slice(0, 17);
      const keyHash = crypto.createHash("sha256").update(org.api_key).digest("hex");
      await client.query(
        "INSERT INTO api_keys (id, organization_id, key_hash, key_prefix, name, scopes, created_at) VALUES (gen_random_uuid(), $1, $2, $3, 'Migrated legacy key', '[\"*\"]'::jsonb, now()) ON CONFLICT (key_prefix) DO NOTHING",
        [org.id, keyHash, keyPrefix],
      );
    }
    await client.query("UPDATE organizations SET api_key = NULL WHERE api_key IS NOT NULL");
    console.log(`Migrated ${rows.length} legacy organization API key(s) to hashes.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
