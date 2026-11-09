import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

async function main() {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const table = await client.query("SELECT to_regclass('public.platform_roles') AS name");
    if (!table.rows[0]?.name) {
      await client.query("COMMIT");
      console.log("Platform role index migration deferred until base schema exists.");
      return;
    }

    const legacy = await client.query(
      "SELECT i.indrelid = 'public.platform_roles'::regclass AS correct_table, i.indisunique AS is_unique " +
      "FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid " +
      "JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relname = 'platform_role_name_unique'",
    );
    if (legacy.rows.length && (!legacy.rows[0].correct_table || !legacy.rows[0].is_unique)) {
      throw new Error("Unexpected platform role index definition: manual review required");
    }

    // Remove only the legacy role-name unique index; never delete role rows.
    await client.query("DROP INDEX IF EXISTS public.platform_role_name_unique");
    await client.query("CREATE INDEX IF NOT EXISTS platform_role_name_idx ON public.platform_roles(role)");
    await client.query("COMMIT");
    console.log("Verified non-unique platform role lookup index.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Platform role index migration failed", error);
  process.exitCode = 1;
});
