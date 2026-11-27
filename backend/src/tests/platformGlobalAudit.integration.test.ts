import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool } from "../db/index.js";
import { grantPlatformAdministrator } from "../services/platformAdminGrantService.js";
import { grantLimitedPlatformRole, revokeLimitedPlatformRole } from "../services/platformRoleManagementService.js";
import { getTwoFactorPolicy, setTwoFactorPolicy } from "../services/platformSecurityService.js";

if (process.env.AUTH_REGRESSION_DESTRUCTIVE_TESTS !== "true") {
  throw new Error("Requires disposable database: global audit integration test");
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL required");

const admin = new pg.Client({ connectionString: adminUrl });
const app = new pg.Client({ connectionString: appUrl });
const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const emails = ids.map((id) => "platform-audit-" + id + "@example.test");

async function main() {
  await admin.connect();
  await app.connect();
  let previousPolicy: "required" | "recommended" | "disabled" | null = null;
  let failureConstraintCreated = false;
  let policyConstraintCreated = false;
  try {
    const existing = await admin.query<{ two_factor_policy: "required" | "recommended" | "disabled" }>(
      "SELECT two_factor_policy FROM platform_security_settings WHERE id = 'global'",
    );
    previousPolicy = existing.rows[0]?.two_factor_policy || null;
    for (let i = 0; i < ids.length; i++) {
      await admin.query(
        "INSERT INTO users (id, name, email) VALUES ($1, 'Platform Audit Integration', $2)",
        [ids[i], emails[i]],
      );
    }

    assert.deepEqual(
      await grantLimitedPlatformRole(emails[0], "PLATFORM_AUDITOR"),
      { userId: ids[0], changed: true },
    );
    assert.deepEqual(
      await grantLimitedPlatformRole(emails[0], "PLATFORM_AUDITOR"),
      { userId: ids[0], changed: false },
    );
    assert.deepEqual(
      await revokeLimitedPlatformRole(emails[0]),
      { userId: ids[0], changed: true },
    );
    assert.deepEqual(
      await revokeLimitedPlatformRole(emails[0]),
      { userId: ids[0], changed: false },
    );
    assert.deepEqual(
      await grantPlatformAdministrator(emails[1]),
      { userId: ids[1], granted: true },
    );

    const initial = await admin.query<{
      action: string;
      resource_id: string;
      actor_identity: string;
      metadata: Record<string, string>;
    }>(
      "SELECT action, resource_id, actor_identity, metadata FROM platform_audit_logs WHERE resource_id = ANY($1::text[]) ORDER BY created_at, action",
      [ids.slice(0, 3)],
    );
    assert.equal(initial.rowCount, 3, "only effective role mutations must be audited");
    assert.deepEqual(
      initial.rows.map((row) => row.action).sort(),
      ["platform.role.granted", "platform.role.revoked", "platform.role.granted"].sort(),
    );
    assert.ok(initial.rows.every((row) => row.actor_identity.startsWith("unix:")));
    assert.ok(initial.rows.some((row) => row.metadata.newRole === "PLATFORM_ADMIN"));
    assert.ok(initial.rows.some((row) => row.metadata.newRole === "PLATFORM_AUDITOR"));
    assert.ok(initial.rows.some((row) => row.metadata.previousRole === "PLATFORM_AUDITOR"));

    // Simulate failed required audit insert. Role/session changes must roll back.
    await admin.query(
      "ALTER TABLE platform_audit_logs ADD CONSTRAINT platform_audit_test_abort " +
      "CHECK (action <> 'platform.role.granted') NOT VALID",
    );
    failureConstraintCreated = true;
    await admin.query(
      "INSERT INTO auth_sessions (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')",
      [randomUUID(), ids[2], "audit-test-session-" + randomUUID()],
    );
    await assert.rejects(grantLimitedPlatformRole(emails[2], "PLATFORM_SUPPORT"));
    const rolledBack = await admin.query<{
      role_count: number;
      session_count: number;
      token_version: number;
    }>(
      "SELECT (SELECT count(*)::integer FROM platform_roles WHERE user_id = $1) AS role_count, " +
      "(SELECT count(*)::integer FROM auth_sessions WHERE user_id = $1) AS session_count, " +
      "(SELECT token_version FROM users WHERE id = $1) AS token_version",
      [ids[2]],
    );
    assert.equal(rolledBack.rows[0].role_count, 0);
    assert.equal(rolledBack.rows[0].session_count, 1, "session deletion must roll back");
    assert.equal(rolledBack.rows[0].token_version, 0, "token version change must roll back");
    await admin.query("ALTER TABLE platform_audit_logs DROP CONSTRAINT platform_audit_test_abort");
    failureConstraintCreated = false;

    // Global settings must use the same transactional audit stream.
    const changedPolicy = previousPolicy === "disabled" ? "required" : "disabled";
    await setTwoFactorPolicy(changedPolicy, ids[3], {
      ipAddress: "127.0.0.1",
      userAgent: "Platform audit integration test",
    });
    await setTwoFactorPolicy(changedPolicy, ids[3]);
    assert.equal(await getTwoFactorPolicy(), changedPolicy);
    const policyAudit = await admin.query<{
      actor_user_id: string;
      metadata: Record<string, string>;
      ip_address: string;
    }>(
      "SELECT actor_user_id, metadata, ip_address FROM platform_audit_logs " +
      "WHERE resource_type = 'platform_security_settings' AND actor_user_id = $1",
      [ids[3]],
    );
    assert.equal(policyAudit.rowCount, 1, "idempotent global policy writes must not add audit events");
    assert.equal(policyAudit.rows[0].metadata.newPolicy, changedPolicy);
    assert.equal(policyAudit.rows[0].ip_address, "127.0.0.1");

    // A global 2FA policy update must also roll back when its audit fails.
    await admin.query(
      "ALTER TABLE platform_audit_logs ADD CONSTRAINT platform_audit_policy_test_abort " +
      "CHECK (action <> 'platform.security.two_factor_policy.changed') NOT VALID",
    );
    policyConstraintCreated = true;
    const attemptedPolicy = changedPolicy === "required" ? "recommended" : "required";
    await assert.rejects(setTwoFactorPolicy(attemptedPolicy, ids[3]));
    const preserved = await admin.query<{ two_factor_policy: string }>(
      "SELECT two_factor_policy FROM platform_security_settings WHERE id = 'global'",
    );
    assert.equal(preserved.rows[0]?.two_factor_policy, changedPolicy);
    assert.equal(await getTwoFactorPolicy(), changedPolicy, "failed write cannot change cached policy");
    await admin.query("ALTER TABLE platform_audit_logs DROP CONSTRAINT platform_audit_policy_test_abort");
    policyConstraintCreated = false;

    // App login must never see, update or delete global audit events.
    await assert.rejects(
      app.query("SELECT id FROM platform_audit_logs"),
      (error: unknown) => (error as { code?: string }).code === "42501",
    );
    await assert.rejects(
      app.query("DELETE FROM platform_audit_logs"),
      (error: unknown) => (error as { code?: string }).code === "42501",
    );
    console.log("Platform global required-audit integration checks passed.");
  } finally {
    if (policyConstraintCreated) {
      await admin.query("ALTER TABLE platform_audit_logs DROP CONSTRAINT platform_audit_policy_test_abort").catch(() => undefined);
    }
    if (failureConstraintCreated) {
      await admin.query("ALTER TABLE platform_audit_logs DROP CONSTRAINT platform_audit_test_abort").catch(() => undefined);
    }
    if (previousPolicy !== null) {
      await setTwoFactorPolicy(previousPolicy, ids[3]).catch(() => undefined);
    } else {
      await admin.query("DELETE FROM platform_security_settings WHERE id = 'global'").catch(() => undefined);
    }
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids]).catch(() => undefined);
    await app.end();
    await admin.end();
    await closeDatabasePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
