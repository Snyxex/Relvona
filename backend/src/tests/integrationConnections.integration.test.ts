import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { IntegrationConnectionService } from "../services/integrationConnectionService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for integration connection tests");

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Integration Tenant', $2), ($3, 'Other Integration Tenant', $4)",
      [organizationId, `integration-${organizationId}`, otherOrganizationId, `integration-other-${otherOrganizationId}`],
    );

    const hubspotToken = `pat-na1-${randomUUID()}-${randomUUID()}`;
    const created = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return IntegrationConnectionService.create({
        organizationId,
        provider: "hubspot",
        name: "Primary HubSpot",
        config: {},
        credentials: { accessToken: hubspotToken },
      });
    });

    assert.equal(created.provider, "hubspot");
    assert.equal(created.credentialsConfigured, true);
    assert.equal("encryptedCredentials" in created, false, "public connection must never expose encrypted credentials");

    const persisted = await admin.query("SELECT encrypted_credentials FROM integration_connections WHERE id = $1", [created.id]);
    assert.equal(persisted.rowCount, 1);
    assert.match(persisted.rows[0].encrypted_credentials, /^enc:/, "credentials must be encrypted at rest");
    assert.equal(persisted.rows[0].encrypted_credentials.includes(hubspotToken), false, "plaintext HubSpot token must not be stored");

    const sameTenant = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return IntegrationConnectionService.list(organizationId);
    });
    assert.equal(sameTenant.length, 1);

    const otherTenant = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(otherOrganizationId);
      return IntegrationConnectionService.list(otherOrganizationId);
    });
    assert.equal(otherTenant.length, 0, "another tenant must not see integration connections");

    await assert.rejects(
      () => withDatabaseTenantContext(async () => {
        setDatabaseTenant(organizationId);
        return IntegrationConnectionService.create({
          organizationId,
          provider: "zendesk",
          name: "Invalid Zendesk",
          config: { subdomain: "evil.example.com", email: "admin@example.test" },
          credentials: { apiToken: "test-api-token-that-is-long-enough" },
        });
      }),
      /Invalid Zendesk subdomain/,
    );

    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      await IntegrationConnectionService.remove(organizationId, created.id);
    });
    const remaining = await admin.query("SELECT id FROM integration_connections WHERE organization_id = $1", [organizationId]);
    assert.equal(remaining.rowCount, 0);

    console.log("Integration connection encryption and tenant isolation test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id IN ($1, $2)", [organizationId, otherOrganizationId]).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
