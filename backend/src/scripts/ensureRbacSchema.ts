import pg from "pg";

const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

async function main() {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const organizations = await client.query("SELECT to_regclass('public.organizations') AS table_name");
    if (!organizations.rows[0]?.table_name) {
      console.log("Organization RBAC schema deferred until the base schema exists.");
      return;
    }
    await client.query(`
    CREATE TABLE IF NOT EXISTS public.organization_role_policies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      role text NOT NULL,
      permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT organization_role_policy_role_check CHECK (role IN ('admin', 'agent', 'viewer'))
    )
    `);
    await client.query(`DO $rbac$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_role_policy_role_check') THEN
          ALTER TABLE public.organization_role_policies ADD CONSTRAINT organization_role_policy_role_check CHECK (role IN ('admin', 'agent', 'viewer'));
        END IF;
      END
    $rbac$`);
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS organization_role_policy_unique ON public.organization_role_policies (organization_id, role)");
    console.log("Verified organization RBAC schema.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error("RBAC schema setup failed:", error); process.exitCode = 1; });
