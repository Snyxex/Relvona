import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Run only against the disposable database provisioned by Jenkins.
if (process.env.AUTH_REGRESSION_DESTRUCTIVE_TESTS !== "true") {
  throw new Error("Requires disposable database: tenant RLS coverage test");
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) {
  throw new Error("DATABASE_ADMIN_URL and DATABASE_URL required for tenant RLS coverage");
}

// These tables are accessed before a tenant context is established, during
// login/domain discovery, invitation acceptance or privileged support-session
// resolution. They require narrowly scoped authenticated resolver functions
// before enabling forced RLS; they are NOT considered protected by this test.
const pendingAuthBootstrapIsolation = new Set([
  "organization_members",
  "organization_dashboard_domains",
  "organization_invitations",
  "platform_support_sessions",
  "sso_login_states",
]);

const protectedStorageTables = [
  "file_objects",
  "knowledge_source_revisions",
  "file_attachments",
  "exports",
] as const;

const admin = new pg.Client({ connectionString: adminUrl });
const app = new pg.Client({ connectionString: appUrl });
const orgA = randomUUID();
const orgB = randomUUID();
const organizations = [orgA, orgB];
const fixtures = organizations.map((organizationId, i) => ({
  organizationId,
  objectId: randomUUID(),
  knowledgeBaseId: randomUUID(),
  sourceId: randomUUID(),
  revisionId: randomUUID(),
  attachmentId: randomUUID(),
  exportId: randomUUID(),
  suffix: String(i),
}));

async function asTenant(organizationId: string, run: () => Promise<void>) {
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.organization_id', $1, true)", [
      organizationId,
    ]);
    await run();
    await app.query("COMMIT");
  } catch (error) {
    await app.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function verifyCoverage() {
  const role = await app.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
  }>(
    "SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles " +
      "WHERE rolname = current_user",
  );
  assert.equal(role.rowCount, 1);
  assert.equal(role.rows[0].rolsuper, false, "application role must not be superuser");
  assert.equal(role.rows[0].rolbypassrls, false, "application role must not bypass RLS");
  assert.equal(role.rows[0].rolcreaterole, false, "application role must not create roles");

  const owned = await app.query<{ name: string }>(
    "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') " +
      "AND pg_has_role(current_user, c.relowner, 'MEMBER')",
  );
  assert.deepEqual(
    owned.rows,
    [],
    "application must neither own nor be a member of the owner of public tables",
  );

  const coverage = await admin.query<{
    name: string;
    rls_enabled: boolean;
    rls_forced: boolean;
  }>(
    "SELECT c.relname AS name, c.relrowsecurity AS rls_enabled, " +
      "c.relforcerowsecurity AS rls_forced FROM pg_class c " +
      "JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "JOIN pg_attribute a ON a.attrelid = c.oid " +
      "AND a.attname IN ('organization_id', 'tenant_id') " +
      "AND a.attnum > 0 AND NOT a.attisdropped " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') " +
      "ORDER BY c.relname",
  );
  assert.ok(coverage.rows.length > 50, "tenant table inventory unexpectedly incomplete");
  const policyRows = await admin.query<{
    tablename: string;
    qual: string | null;
    with_check: string | null;
  }>(
    "SELECT tablename, qual, with_check FROM pg_policies " +
      "WHERE schemaname = 'public' AND policyname = 'supportai_tenant_isolation'",
  );
  const policies = new Map(policyRows.rows.map((row) => [row.tablename, row]));
  const uncovered = coverage.rows.filter((row) => {
    if (pendingAuthBootstrapIsolation.has(row.name)) return false;
    const policy = policies.get(row.name);
    return !row.rls_enabled || !row.rls_forced ||
      !policy?.qual?.includes("app.organization_id") ||
      !policy.with_check?.includes("app.organization_id");
  }).map((row) => row.name);
  assert.deepEqual(uncovered, [], "RLS coverage missing for tenant-owned tables");
  for (const table of protectedStorageTables) {
    assert.ok(
      coverage.rows.some((row) => row.name === table),
      "missing protected storage table: " + table,
    );
  }
  console.warn(
    "P0 unresolved: pre-auth tenant table isolation requires dedicated resolvers: " +
      [...pendingAuthBootstrapIsolation].join(", "),
  );
}

async function createFixtures() {
  for (const f of fixtures) {
    await admin.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, 'RLS Coverage Test', $2)",
      [f.organizationId, "rls-coverage-" + f.organizationId],
    );
    await admin.query(
      "INSERT INTO file_objects " +
      "(id, organization_id, storage_key, storage_class, original_filename, mime_type, file_size, sha256) " +
      "VALUES ($1, $2, $3, 'ATTACHMENT', 'test.txt', 'text/plain', 4, $4)",
      [f.objectId, f.organizationId, "rls-test/" + f.objectId, f.suffix.repeat(64)],
    );
    await admin.query(
      "INSERT INTO knowledge_bases (id, organization_id, name) VALUES ($1, $2, 'Isolation Test')",
      [f.knowledgeBaseId, f.organizationId],
    );
    await admin.query(
      "INSERT INTO knowledge_sources (id, organization_id, knowledge_base_id, title, type) " +
      "VALUES ($1, $2, $3, 'Isolation Test', 'document')",
      [f.sourceId, f.organizationId, f.knowledgeBaseId],
    );
    await admin.query(
      "INSERT INTO knowledge_source_revisions (id, organization_id, source_id, revision) " +
      "VALUES ($1, $2, $3, 1)",
      [f.revisionId, f.organizationId, f.sourceId],
    );
    await admin.query(
      "INSERT INTO file_attachments " +
      "(id, organization_id, file_object_id, uploader_type, original_filename, mime_type, file_size) " +
      "VALUES ($1, $2, $3, 'EMPLOYEE', 'test.txt', 'text/plain', 4)",
      [f.attachmentId, f.organizationId, f.objectId],
    );
    await admin.query(
      "INSERT INTO exports (id, organization_id, file_object_id, export_type) " +
      "VALUES ($1, $2, $3, 'CONVERSATION')",
      [f.exportId, f.organizationId, f.objectId],
    );
  }
}

async function verifyDataBoundaries() {
  const objectId = (f: (typeof fixtures)[number], table: string) =>
    table === "file_objects" ? f.objectId :
    table === "file_attachments" ? f.attachmentId :
    table === "exports" ? f.exportId : f.revisionId;
  for (const [index, f] of fixtures.entries()) {
    const other = fixtures[1 - index];
    await asTenant(f.organizationId, async () => {
      for (const table of protectedStorageTables) {
        const own = await app.query("SELECT id FROM " + table + " WHERE id = $1", [
          objectId(f, table),
        ]);
        assert.equal(own.rowCount, 1, table + " must expose own data");
        const foreign = await app.query(
          "SELECT id FROM " + table + " WHERE id = $1",
          [objectId(other, table)],
        );
        assert.equal(foreign.rowCount, 0, table + " leaked cross-tenant data");
        const update = await app.query(
          "UPDATE " + table + " SET updated_at = updated_at WHERE id = $1",
          [objectId(other, table)],
        );
        assert.equal(update.rowCount, 0, table + " modified foreign data");
        const deleted = await app.query("DELETE FROM " + table + " WHERE id = $1", [
          objectId(other, table),
        ]);
        assert.equal(deleted.rowCount, 0, table + " deleted foreign data");
      }
    });
  }

  await asTenant(orgA, async () => {
    await assert.rejects(
      app.query(
        "INSERT INTO exports (organization_id, export_type) VALUES ($1, 'CONVERSATION')",
        [orgB],
      ),
      (error: unknown) => (error as { code?: string }).code === "42501",
      "tenant A must not insert a tenant B export",
    );
  });

  // No tenant context must not grant access to tenant-owned storage rows.
  const withoutTenant = await app.query(
    "SELECT id FROM file_objects WHERE id = $1",
    [fixtures[0].objectId],
  );
  assert.equal(withoutTenant.rowCount, 0, "unscoped storage read must fail closed");
}

async function main() {
  await admin.connect();
  await app.connect();
  try {
    await verifyCoverage();
    await createFixtures();
    await verifyDataBoundaries();
    console.log("Tenant storage RLS coverage and cross-tenant CRUD checks passed");
  } finally {
    const toDelete = [
      "file_attachments",
      "exports",
      "knowledge_source_revisions",
      "knowledge_sources",
      "knowledge_bases",
      "file_objects",
    ];
    for (const table of toDelete) {
      await admin.query(
        "DELETE FROM " + table + " WHERE organization_id = ANY($1::uuid[])",
        [organizations],
      ).catch(() => undefined);
    }
    await admin.query(
      "DELETE FROM organizations WHERE id = ANY($1::uuid[])",
      [organizations],
    ).catch(() => undefined);
    await app.end();
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
