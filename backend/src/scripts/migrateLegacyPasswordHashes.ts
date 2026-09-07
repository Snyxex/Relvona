import crypto from "crypto";
import { pool } from "../db/index.js";
import { LEGACY_PASSWORD_SENTINEL } from "../auth/password.js";

async function migrateLegacyPasswordHashes() {
  const client = await pool.connect();
  let migratedAccounts = 0;
  let existingAccounts = 0;

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(724020)");

    const legacyUsers = await client.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash
       FROM users
       WHERE password_hash IS NOT NULL
         AND password_hash <> $1
       FOR UPDATE`,
      [LEGACY_PASSWORD_SENTINEL],
    );

    for (const user of legacyUsers.rows) {
      const account = await client.query<{ id: string; password: string | null }>(
        `SELECT id, password
         FROM auth_accounts
         WHERE user_id = $1
           AND provider_id = 'credential'
         LIMIT 1
         FOR UPDATE`,
        [user.id],
      );

      if (!account.rowCount) {
        await client.query(
          `INSERT INTO auth_accounts (id, account_id, provider_id, issuer, user_id, password)
           VALUES ($1, $2, 'credential', 'local:credential', $3, $4)`,
          [crypto.randomUUID(), user.id, user.id, user.password_hash],
        );
        migratedAccounts += 1;
      } else if (!account.rows[0].password) {
        await client.query(
          "UPDATE auth_accounts SET password = $1, updated_at = now() WHERE id = $2",
          [user.password_hash, account.rows[0].id],
        );
        migratedAccounts += 1;
      } else {
        // auth_accounts is already authoritative. Never overwrite a potentially
        // newer Better Auth password with stale legacy user data.
        existingAccounts += 1;
      }

      await client.query(
        "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
        [LEGACY_PASSWORD_SENTINEL, user.id],
      );
    }

    await client.query("COMMIT");
    console.log(`Legacy password migration complete: ${migratedAccounts} credentials migrated, ${existingAccounts} existing Better Auth credentials preserved, ${legacyUsers.rowCount ?? 0} user rows scrubbed.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateLegacyPasswordHashes().catch((error) => {
  console.error("Legacy password migration failed", error);
  process.exitCode = 1;
});
