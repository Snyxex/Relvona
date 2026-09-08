import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { ActionExecutionService } from "../services/actionExecutionService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for action approval integration tests");

const organizationId = randomUUID();
const requesterId = randomUUID();
const approverId = randomUUID();
const executionId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'Approval Separation', $2, $3)", [organizationId, `approval-${organizationId}`, `approval-key-${organizationId}`]);
    await admin.query(
      "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $3, 'test', 'Requester'), ($2, $4, 'test', 'Approver')",
      [requesterId, approverId, `requester-${requesterId}@example.test`, `approver-${approverId}@example.test`],
    );
    await admin.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'agent'), ($1, $3, 'admin')",
      [organizationId, requesterId, approverId],
    );
    await admin.query(
      "INSERT INTO action_executions (id, organization_id, tool_id, input, status, risk_level, requires_approval, requested_by_type, requested_by_user_id, expires_at) VALUES ($1, $2, 'scheduling.cancel_booking', '{}'::jsonb, 'pending', 'write', true, 'user', $3, NOW() + INTERVAL '30 minutes')",
      [executionId, organizationId, requesterId],
    );

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await assert.rejects(
        () => ActionExecutionService.approve({ organizationId, executionId, userId: requesterId }),
        /requester cannot approve or reject their own action/i,
      );
      await assert.rejects(
        () => ActionExecutionService.reject({ organizationId, executionId, userId: requesterId }),
        /requester cannot approve or reject their own action/i,
      );
      const approved = await ActionExecutionService.approve({ organizationId, executionId, userId: approverId, reason: "Independent review" });
      assert.equal(approved.status, "approved");
      assert.equal(approved.approvedByUserId, approverId);
    });

    console.log("Action approval separation integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[requesterId, approverId]]).catch(() => undefined);
    await closeDatabasePool().catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
