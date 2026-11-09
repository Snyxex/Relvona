import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Response } from "express";
import { closeDatabasePool } from "../db/index.js";
import { withDatabaseTenantContext } from "../db/tenantContext.js";
import { tenantContext, requireRole, PLATFORM_SUPPORT_READ_PERMISSIONS, type AuthRequest } from "../middleware/auth.js";

if (process.env.AUTH_REGRESSION_DESTRUCTIVE_TESTS !== "true") {
  throw new Error("Support session integration tests require a disposable database");
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL required for support-session integration");

const admin = new pg.Client({ connectionString: adminUrl });
const operatorId = randomUUID();
const ownerOrganizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const operatorEmail = "support-operator-" + operatorId + "@example.test";

type Evaluation = {
  status: number;
  body: unknown;
  passed: boolean;
  req: AuthRequest;
};

async function evaluate(
  userId: string, organizationId: string, method: string, sessionId?: string,
): Promise<Evaluation> {
  let status = 200;
  let body: unknown;
  let passed = false;
  const req = {
    method,
    originalUrl: "/api/v1/admin/settings/models",
    headers: {
      "x-organization-id": organizationId,
      ...(sessionId ? { "x-support-session-id": sessionId } : {}),
    },
    user: {
      id: userId,
      email: operatorEmail,
      isPlatformAdmin: true,
      systemRole: "superadmin",
      twoFactorEnabled: true,
      twoFactorPolicy: "recommended",
    },
  } as unknown as AuthRequest;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  await withDatabaseTenantContext(() => tenantContext(req, res, () => { passed = true; }));
  return { status, body, passed, req };
}

function evaluateSettingsRead(req: AuthRequest) {
  let passed = false;
  let status = 200;
  const res = {
    status(code: number) { status = code; return this; },
    json() { return this; },
  } as unknown as Response;
  requireRole(["owner", "admin"])(req, res, () => { passed = true; });
  return { passed, status };
}

async function main() {
  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO users (id, name, email) VALUES ($1, 'Support Operator', $2)",
      [operatorId, operatorEmail],
    );
    await admin.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Owned Organization', $2), ($3, 'Foreign Organization', $4)",
      [ownerOrganizationId, "support-own-" + ownerOrganizationId, foreignOrganizationId, "support-foreign-" + foreignOrganizationId],
    );
    await admin.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [ownerOrganizationId, operatorId],
    );
    // A tenant can configure the normal viewer role with manage permissions.
    // This must NEVER enlarge an operator's temporary support-session rights.
    await admin.query(
      "INSERT INTO organization_role_policies (organization_id, role, permissions) VALUES ($1, 'viewer', $2::jsonb)",
      [foreignOrganizationId, JSON.stringify(["settings.manage", "tickets.manage"])],
    );

    const sessionRow = await admin.query<{ id: string }>(
      "INSERT INTO platform_support_sessions (platform_admin_user_id, organization_id, reason, expires_at) " +
      "VALUES ($1, $2, 'Read-only incident investigation', now() + interval '15 minutes') RETURNING id",
      [operatorId, foreignOrganizationId],
    );
    const sessionId = sessionRow.rows[0].id;

    const missing = await evaluate(operatorId, foreignOrganizationId, "GET");
    assert.equal(missing.status, 403);
    assert.deepEqual(missing.body, { error: "SUPPORT_ACCESS_REQUIRED" });

    const read = await evaluate(operatorId, foreignOrganizationId, "GET", sessionId);
    assert.equal(read.status, 200);
    assert.equal(read.passed, true);
    assert.equal(read.req.organization?.role, "viewer", "support sessions must not impersonate tenant administrators");
    assert.deepEqual(read.req.organization?.permissions, [...PLATFORM_SUPPORT_READ_PERMISSIONS]);
    assert.equal(read.req.organization?.permissions.includes("tickets.manage"), false);
    assert.equal(read.req.organization?.permissions.includes("settings.manage"), false);
    assert.deepEqual(evaluateSettingsRead(read.req), { status: 200, passed: true }, "authorized settings reads must continue to work");

    const write = await evaluate(operatorId, foreignOrganizationId, "POST", sessionId);
    assert.equal(write.status, 403);
    assert.deepEqual(write.body, { error: "SUPPORT_SESSION_READ_ONLY" });
    assert.equal(write.passed, false, "a support session may not proceed to write handlers");

    const wrongOperator = await evaluate(randomUUID(), foreignOrganizationId, "GET", sessionId);
    assert.equal(wrongOperator.status, 403);
    assert.deepEqual(wrongOperator.body, { error: "SUPPORT_ACCESS_EXPIRED" }, "support tokens must be operator-bound");

    const ownWrite = await evaluate(operatorId, ownerOrganizationId, "POST", sessionId);
    assert.equal(ownWrite.status, 200);
    assert.equal(ownWrite.req.organization?.role, "owner", "real memberships take precedence over support sessions");
    assert.ok(ownWrite.req.organization?.permissions.includes("tickets.manage"));

    await admin.query("UPDATE platform_support_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1", [sessionId]);
    const expired = await evaluate(operatorId, foreignOrganizationId, "GET", sessionId);
    assert.equal(expired.status, 403);
    assert.deepEqual(expired.body, { error: "SUPPORT_ACCESS_EXPIRED" });

    await admin.query("UPDATE platform_support_sessions SET expires_at = now() + interval '15 minutes', ended_at = now() WHERE id = $1", [sessionId]);
    const ended = await evaluate(operatorId, foreignOrganizationId, "GET", sessionId);
    assert.equal(ended.status, 403);
    assert.deepEqual(ended.body, { error: "SUPPORT_ACCESS_EXPIRED" });

    console.log("Platform support-session least privilege integration tests passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[ownerOrganizationId, foreignOrganizationId]]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE id = $1", [operatorId]).catch(() => undefined);
    await admin.end();
    await closeDatabasePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
