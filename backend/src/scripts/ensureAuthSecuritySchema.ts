import pg from "pg";

const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const users = await client.query("SELECT to_regclass('public.users') AS table_name");
    if (!users.rows[0]?.table_name) {
      console.log("Auth security schema deferred until the base schema exists.");
      return;
    }
    await client.query("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false");
    await client.query("CREATE TABLE IF NOT EXISTS public.auth_two_factors (id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, secret text NOT NULL, backup_codes text NOT NULL, verified boolean NOT NULL DEFAULT false, failed_verification_count integer NOT NULL DEFAULT 0, locked_until timestamp)");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS auth_two_factor_user_unique ON public.auth_two_factors (user_id)");
    await client.query("CREATE TABLE IF NOT EXISTS public.platform_security_settings (id text PRIMARY KEY, two_factor_policy text NOT NULL DEFAULT 'recommended', updated_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())");
    await client.query("DO $policy$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_two_factor_policy_check') THEN ALTER TABLE public.platform_security_settings ADD CONSTRAINT platform_two_factor_policy_check CHECK (two_factor_policy IN ('required', 'recommended', 'disabled')); END IF; END $policy$");
    await client.query("INSERT INTO public.platform_security_settings (id, two_factor_policy) VALUES ('global', 'recommended') ON CONFLICT (id) DO NOTHING");
    console.log("Verified Better Auth 2FA and platform security schema.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error("Auth security schema setup failed:", error); process.exitCode = 1; });
