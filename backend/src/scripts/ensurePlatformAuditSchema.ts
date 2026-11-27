import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for the platform audit migration");

async function main() {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_identity text NOT NULL,
        actor_user_id uuid,
        action text NOT NULL,
        resource_type text NOT NULL,
        resource_id text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ip_address text,
        user_agent text,
        created_at timestamp without time zone NOT NULL DEFAULT now()
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS platform_audit_created_idx ON public.platform_audit_logs(created_at)");
    await client.query("CREATE INDEX IF NOT EXISTS platform_audit_resource_idx ON public.platform_audit_logs(resource_type, resource_id, created_at)");
    await client.query("COMMIT");
    console.log("Global platform audit schema verified.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Global platform audit schema migration failed", error);
  process.exitCode = 1;
});
