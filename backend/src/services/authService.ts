import crypto from "crypto";
import { pool } from "../db/index.js";
import { hashPassword, LEGACY_PASSWORD_SENTINEL } from "../auth/password.js";
import { PLATFORM_ADMIN_ROLE } from "../db/platformRoles.js";

export class AuthService {
  static async platformBootstrapRequired() {
    const result = await pool.query("SELECT 1 FROM platform_roles WHERE role = $1 LIMIT 1", [PLATFORM_ADMIN_ROLE]);
    return result.rowCount === 0;
  }

  static async bootstrapPlatformAdmin(data: { name: string; email: string; password: string }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(724019)");
      if ((await client.query("SELECT 1 FROM platform_roles WHERE role = $1 LIMIT 1", [PLATFORM_ADMIN_ROLE])).rowCount) {
        throw new Error("PLATFORM_ADMIN_ALREADY_EXISTS");
      }

      const email = data.email.toLowerCase().trim();
      const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (existing.rowCount) throw new Error("Email address already registered");

      const credentialHash = await hashPassword(data.password);
      const created = await client.query(
        "INSERT INTO users (name, email, password_hash, email_verified, system_role) VALUES ($1, $2, $3, true, 'user') RETURNING id, name, email, avatar_url, preferred_language",
        [data.name.trim(), email, LEGACY_PASSWORD_SENTINEL],
      );
      const user = created.rows[0];

      await client.query(
        "INSERT INTO auth_accounts (id, account_id, provider_id, issuer, user_id, password) VALUES ($1, $2, 'credential', 'local:credential', $3, $4)",
        [crypto.randomUUID(), user.id, user.id, credentialHash],
      );
      await client.query(
        "INSERT INTO platform_roles (user_id, role) VALUES ($1, $2)",
        [user.id, PLATFORM_ADMIN_ROLE],
      );

      await client.query("COMMIT");
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatar_url,
          preferredLanguage: user.preferred_language,
          isPlatformAdmin: true,
        },
        organizations: [],
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
