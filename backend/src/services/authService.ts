import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "../db/index.js";
import { pool } from "../db/index.js";

export class AuthService {
  static async platformBootstrapRequired() { const result = await pool.query("SELECT 1 FROM users WHERE system_role = 'superadmin' LIMIT 1"); return result.rowCount === 0; }
  static async bootstrapPlatformAdmin(data: { name: string; email: string; password: string }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(724019)");
      if ((await client.query("SELECT 1 FROM users WHERE system_role = 'superadmin' LIMIT 1")).rowCount) throw new Error("PLATFORM_ADMIN_ALREADY_EXISTS");
      const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [data.email.toLowerCase().trim()]);
      if (existing.rowCount) throw new Error("Email address already registered");
      const passwordHash = await bcrypt.hash(data.password, 12);
      const created = await client.query("INSERT INTO users (name, email, password_hash, email_verified, system_role) VALUES ($1, $2, $3, true, 'superadmin') RETURNING id, name, email, avatar_url, preferred_language, system_role", [data.name.trim(), data.email.toLowerCase().trim(), passwordHash]);
      const user = created.rows[0];
      await client.query("INSERT INTO auth_accounts (id, account_id, provider_id, issuer, user_id, password) VALUES ($1, $2, 'credential', 'local:credential', $3, $4)", [crypto.randomUUID(), user.id, user.id, passwordHash]);
      await client.query("COMMIT");
      return { user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url, preferredLanguage: user.preferred_language, systemRole: user.system_role }, organizations: [] };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }
}
