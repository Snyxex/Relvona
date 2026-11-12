import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool } from "../db/index.js";
import { getPlatformRole, isPlatformAdmin } from "../auth/session.js";
import { grantLimitedPlatformRole, revokeLimitedPlatformRole } from "../services/platformRoleManagementService.js";

if (process.env.AUTH_REGRESSION_DESTRUCTIVE_TESTS !== "true") {
  throw new Error("Requires a disposable integration database");
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required");
const admin = new pg.Client({ connectionString: adminUrl });
const supportEmail = "rbac-support-" + randomUUID() + "@example.test";
const auditorEmail = "rbac-auditor-" + randomUUID() + "@example.test";
const administratorEmail = "rbac-admin-" + randomUUID() + "@example.test";
const emails = [supportEmail, auditorEmail, administratorEmail];

async function main() {
  await admin.connect();
  try {
    const identities = await Promise.all(emails.map(async (email) => {
      const created = await admin.query<{ id: string; token_version: number }>(
        "INSERT INTO users (name, email) VALUES ('RBAC Test Operator', $1) RETURNING id, token_version",
        [email],
      );
      return created.rows[0];
    }));
    const [supportUser, auditorUser, administratorUser] = identities;
    assert.equal(await getPlatformRole(supportUser.id), null);

    await admin.query(
      "INSERT INTO auth_sessions (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')",
      [randomUUID(), supportUser.id, "rbac-session-" + randomUUID()],
    );
    assert.deepEqual(
      await grantLimitedPlatformRole(supportEmail.toUpperCase(), "PLATFORM_SUPPORT"),
      { userId: supportUser.id, changed: true },
    );
    assert.equal(await getPlatformRole(supportUser.id), "PLATFORM_SUPPORT");
    assert.equal(await isPlatformAdmin(supportUser.id), false);
    const sessionCount = await admin.query<{ value: number }>(
      "SELECT count(*)::integer AS value FROM auth_sessions WHERE user_id = $1", [supportUser.id],
    );
    assert.equal(sessionCount.rows[0].value, 0, "pre-grant sessions revoked");
    const grantVersion = await admin.query<{ token_version: number }>(
      "SELECT token_version FROM users WHERE id = $1", [supportUser.id],
    );
    assert.equal(grantVersion.rows[0].token_version, supportUser.token_version + 1);

    assert.deepEqual(
      await grantLimitedPlatformRole(supportEmail, "PLATFORM_SUPPORT"),
      { userId: supportUser.id, changed: false },
    );
    assert.equal((await admin.query<{ token_version: number }>(
      "SELECT token_version FROM users WHERE id = $1", [supportUser.id],
    )).rows[0].token_version, grantVersion.rows[0].token_version, "idempotent grants do not revoke sessions");

    await assert.rejects(
      grantLimitedPlatformRole(supportEmail, "PLATFORM_AUDITOR"), /PLATFORM_ROLE_CONFLICT_REQUIRES_REVIEW/,
    );
    assert.deepEqual(
      await grantLimitedPlatformRole(auditorEmail, "PLATFORM_AUDITOR"),
      { userId: auditorUser.id, changed: true },
    );
    assert.equal(await getPlatformRole(auditorUser.id), "PLATFORM_AUDITOR");

    await admin.query("INSERT INTO platform_roles (user_id, role) VALUES ($1, 'PLATFORM_ADMIN')", [administratorUser.id]);
    await assert.rejects(
      revokeLimitedPlatformRole(administratorEmail), /REFUSE_REVOKE_PLATFORM_ADMIN/,
    );
    await assert.rejects(
      grantLimitedPlatformRole(administratorEmail, "PLATFORM_SUPPORT"), /PLATFORM_ROLE_CONFLICT_REQUIRES_REVIEW/,
    );

    assert.deepEqual(
      await revokeLimitedPlatformRole(supportEmail),
      { userId: supportUser.id, changed: true },
    );
    assert.equal(await getPlatformRole(supportUser.id), null);
    assert.deepEqual(
      await revokeLimitedPlatformRole(supportEmail),
      { userId: supportUser.id, changed: false },
    );
    const revokeVersion = await admin.query<{ token_version: number }>(
      "SELECT token_version FROM users WHERE id = $1", [supportUser.id],
    );
    assert.equal(revokeVersion.rows[0].token_version, grantVersion.rows[0].token_version + 1);

    await assert.rejects(grantLimitedPlatformRole("missing-" + randomUUID() + "@example.test", "PLATFORM_SUPPORT"), /USER_NOT_FOUND/);
    console.log("Platform scoped role grant/revoke integration tests passed.");
  } finally {
    await admin.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]).catch(() => undefined);
    await admin.end();
    await closeDatabasePool();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
