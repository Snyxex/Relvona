import pg from "pg";

const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // Keep additive compatibility migrations explicit and idempotent. Existing
    // databases may predate columns that were added after the initial Drizzle
    // snapshot, and `drizzle-kit push` can require interactive decisions.
    await client.query("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'de'");
    await client.query("ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS open_conversation_ticket_unique ON public.tickets (organization_id, conversation_id) WHERE source = 'ai_escalation' AND conversation_id IS NOT NULL AND status NOT IN ('resolved', 'closed')");

    // Older installations used a smaller api_keys table. Add the hashing and
    // lifecycle fields before legacy organization keys are copied into it.
    await client.query("ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS key_prefix text");
    await client.query("ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS scopes jsonb NOT NULL DEFAULT '[\"*\"]'::jsonb");
    await client.query("ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS expires_at timestamp");
    await client.query("ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS revoked_at timestamp");
    await client.query("UPDATE public.api_keys SET key_prefix = 'legacy_' || id::text WHERE key_prefix IS NULL");
    await client.query("ALTER TABLE public.api_keys ALTER COLUMN key_prefix SET NOT NULL");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS api_key_prefix_unique ON public.api_keys (key_prefix)");
    console.log("Verified application compatibility schema.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error("Application schema setup failed:", error); process.exitCode = 1; });
