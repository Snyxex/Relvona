import { pool } from "../db/index.js";
import { PLATFORM_ADMIN_ROLE } from "../db/platformRoles.js";

async function migratePlatformRoles() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(724021)");

    const legacyAdmins = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE system_role = 'superadmin' ORDER BY created_at ASC FOR UPDATE",
    );

    if ((legacyAdmins.rowCount ?? 0) > 1) {
      throw new Error("MULTIPLE_LEGACY_PLATFORM_ADMINS_REQUIRE_MANUAL_REVIEW");
    }

    const legacyAdmin = legacyAdmins.rows[0];
    if (legacyAdmin) {
      await client.query(
        `INSERT INTO platform_roles (user_id, role)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
        [legacyAdmin.id, PLATFORM_ADMIN_ROLE],
      );
      await client.query(
        "UPDATE users SET system_role = 'user', updated_at = now() WHERE id = $1",
        [legacyAdmin.id],
      );
    }

    await client.query("COMMIT");
    console.log(`Platform role migration complete${legacyAdmin ? ` for user ${legacyAdmin.id}` : " (no legacy superadmin found)"}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migratePlatformRoles().catch((error) => {
  console.error("Platform role migration failed", error);
  process.exitCode = 1;
});
