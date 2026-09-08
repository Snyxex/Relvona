import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { AssistantVersionService } from "../services/assistantVersionService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for assistant version integration tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const userId = randomUUID();
const assistantId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Agent Versions', $2), ($3, 'Other Tenant', $4)",
      [organizationId, `agent-versions-${organizationId}`, otherOrganizationId, `other-agent-versions-${otherOrganizationId}`],
    );
    await admin.query(
      "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'test-hash', 'Version Admin')",
      [userId, `version-${userId}@example.test`],
    );
    await admin.query(
      "INSERT INTO assistants (id, organization_id, name, system_prompt, model_provider, model_name, api_key, temperature) VALUES ($1, $2, 'Versioned Agent', 'Prompt v1', 'openai', 'model-v1', 'enc:test-secret', 0.2)",
      [assistantId, organizationId],
    );

    const first = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return AssistantVersionService.publish({ organizationId, assistantId, userId, label: "Stable v1" });
    });
    assert.equal(first.version, 1);
    assert.equal(first.snapshot.systemPrompt, "Prompt v1");
    assert.equal(first.snapshot.apiKeyConfigured, true);
    assert.equal("apiKey" in first.snapshot, false, "published API snapshot must not expose encrypted provider secrets");

    await admin.query(
      "UPDATE assistants SET system_prompt = 'Prompt v2', model_name = 'model-v2', temperature = 0.7 WHERE id = $1 AND organization_id = $2",
      [assistantId, organizationId],
    );

    const second = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return AssistantVersionService.publish({ organizationId, assistantId, userId, label: "Experiment v2" });
    });
    assert.equal(second.version, 2);
    assert.equal(second.snapshot.systemPrompt, "Prompt v2");

    const invisible = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(otherOrganizationId);
      return AssistantVersionService.list(otherOrganizationId, assistantId);
    });
    assert.equal(invisible.length, 0, "another tenant must not see assistant versions");

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await AssistantVersionService.activate({ organizationId, assistantId, versionId: first.id });
    });

    const restored = await admin.query(
      "SELECT system_prompt, model_name, temperature FROM assistants WHERE id = $1 AND organization_id = $2",
      [assistantId, organizationId],
    );
    assert.equal(restored.rows[0].system_prompt, "Prompt v1");
    assert.equal(restored.rows[0].model_name, "model-v1");
    assert.equal(Number(restored.rows[0].temperature), 0.2);

    let versions = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return AssistantVersionService.list(organizationId, assistantId);
    });
    assert.equal(versions.length, 2);
    assert.equal(versions.find((version) => version.id === first.id)?.status, "active");
    assert.equal(versions.find((version) => version.id === second.id)?.status, "published");

    await admin.query(
      "UPDATE assistants SET system_prompt = 'Manual live draft' WHERE id = $1 AND organization_id = $2",
      [assistantId, organizationId],
    );
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await AssistantVersionService.markLiveDraft(organizationId, assistantId);
    });
    versions = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return AssistantVersionService.list(organizationId, assistantId);
    });
    assert.equal(versions.some((version) => version.status === "active"), false, "manual live drift must clear the active-version marker");
    assert.equal(versions.find((version) => version.id === first.id)?.status, "archived");

    console.log("Assistant version integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id IN ($1, $2)", [organizationId, otherOrganizationId]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
