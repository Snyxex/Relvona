import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool } from "../db/index.js";
import { PlatformOperationsService } from "../services/platformOperationsService.js";

if (process.env.AUTH_REGRESSION_DESTRUCTIVE_TESTS !== "true") {
  throw new Error("Run platform audit integration tests only against a disposable database");
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL are required");

const organizationId = randomUUID();
const operatorId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });
const app = new pg.Client({ connectionString: appUrl });
const actor = { userId: operatorId, ipAddress: "127.0.0.1", userAgent: "Relvona audit integration test" };

async function main() {
  await admin.connect();
  await app.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Platform Audit Test', $2)",
      [organizationId, "platform-audit-" + organizationId],
    );
    await admin.query(
      "INSERT INTO users (id, name, email) VALUES ($1, 'Audit Test Operator', $2)",
      [operatorId, "platform-audit-" + operatorId + "@example.test"],
    );

    const updated = await PlatformOperationsService.updateOrganizationStatus(organizationId, "suspended", actor);
    assert.deepEqual(updated, { id: organizationId, status: "suspended" });

    const session = await PlatformOperationsService.startSupportSession(
      organizationId, "Investigating a tenant request", 12, actor,
    );
    assert.ok(session, "support session and audit event must commit together");
    assert.equal(session.organizationId, organizationId);
    assert.ok(session.expiresAt.getTime() > Date.now());
    assert.ok(session.expiresAt.getTime() <= Date.now() + 12 * 60_000 + 1000);
    assert.equal(await PlatformOperationsService.endSupportSession(session.id, { userId: randomUUID() }), false, "other operators cannot end sessions");
    assert.equal(await PlatformOperationsService.endSupportSession(session.id, actor), true);
    assert.equal(await PlatformOperationsService.endSupportSession(session.id, actor), false, "already ended sessions cannot be ended twice");

    const audit = await admin.query<{
      action: string;
      resource_id: string;
      actor_user_id: string;
      metadata: Record<string, string>;
    }>(
      "SELECT action, resource_id, actor_user_id, metadata FROM audit_logs WHERE organization_id = $1 ORDER BY created_at, action",
      [organizationId],
    );
    assert.equal(audit.rowCount, 3, "each privileged mutation must write one durable audit entry");
    assert.deepEqual(
      audit.rows.map((row) => row.action).sort(),
      ["platform.organization.suspended", "platform.support_access.ended", "platform.support_access.started"].sort(),
    );
    assert.ok(audit.rows.every((row) => row.actor_user_id === operatorId));
    assert.ok(audit.rows.some((row) => row.action === "platform.support_access.started" && row.metadata.reason === "Investigating a tenant request"));

    const unscoped = await app.query("SELECT id FROM audit_logs WHERE organization_id = $1", [organizationId]);
    assert.equal(unscoped.rowCount, 0, "forced RLS must hide audit rows without tenant context");
    await app.query("BEGIN");
    try {
      await app.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const scoped = await app.query("SELECT id FROM audit_logs WHERE organization_id = $1", [organizationId]);
      assert.equal(scoped.rowCount, 3, "the right tenant must be able to read its own audit records");
    } finally {
      await app.query("ROLLBACK");
    }

    // Invalid audit actor: FK failure must also roll back the status update.
    await assert.rejects(
      PlatformOperationsService.updateOrganizationStatus(organizationId, "disabled", { userId: randomUUID() }),
      (error: unknown) => {
        let current: unknown = error;
        while (current && typeof current === "object") {
          const candidate = current as { code?: string; constraint?: string; message?: string };
          if (
            candidate.code === "23503" ||
            candidate.constraint === "audit_logs_actor_user_id_users_id_fk" ||
            /foreign key|23503/i.test(candidate.message ?? "")
          ) {
            return true;
          }
          current = (current as { cause?: unknown }).cause;
        }
        return /foreign key|23503/i.test(String(error));
      },
    );
    const unchanged = await admin.query("SELECT status FROM organizations WHERE id = $1", [organizationId]);
    assert.equal(unchanged.rows[0].status, "suspended", "status change must roll back if audit insertion fails");
    const afterFailure = await admin.query("SELECT COUNT(*)::integer AS count FROM audit_logs WHERE organization_id = $1", [organizationId]);
    assert.equal(afterFailure.rows[0].count, 3, "failed mutations must not create partial audit records");

    console.log("Platform privileged-operation atomic audit integration tests passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE id = $1", [operatorId]).catch(() => undefined);
    await app.end();
    await admin.end();
    await closeDatabasePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
