import pg from "pg";

const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("ALTER TABLE public.assistants ADD COLUMN IF NOT EXISTS widget_api_key text");
    await client.query("ALTER TABLE public.assistants ADD COLUMN IF NOT EXISTS widget_allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb");
    await client.query("ALTER TABLE public.assistants ADD COLUMN IF NOT EXISTS chat_page_enabled boolean NOT NULL DEFAULT false");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS assistants_widget_api_key_unique ON public.assistants (widget_api_key)");
    console.log("Verified widget integration schema.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error("Widget integration schema setup failed:", error); process.exitCode = 1; });
