import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import pg from "pg";
import { AuthService } from "../services/authService.js";
import { InvitationService } from "../services/invitationService.js";
import { EntraAuthService } from "../services/entraAuthService.js";
import { LEGACY_PASSWORD_SENTINEL } from "../auth/password.js";
import { PLATFORM_ADMIN_ROLE } from "../db/platformRoles.js";
import { closeDatabasePool } from "../db/index.js";

if (process.env.AUTH_REGRESSION_DESTRUCTIVE_TESTS !== "true") {
  throw new Error("AUTH_REGRESSION_DESTRUCTIVE_TESTS=true is required; run this suite only against a disposable database");
}

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required");
const admin = new pg.Client({ connectionString: adminUrl });
const createdOrganizations: string[] = [];
const createdEmails: string[] = [];
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

async function rejectsCode(work: () => Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => error instanceof Error && error.message === code);
}

async function testPlatformBootstrapRace() {
  const suffix = randomUUID();
  const candidates = [
    { name: "Bootstrap A", email: `bootstrap-a-${suffix}@example.test`, password: "VeryStrongPassword-123-A" },
    { name: "Bootstrap B", email: `bootstrap-b-${suffix}@example.test`, password: "VeryStrongPassword-123-B" },
  ];
  createdEmails.push(...candidates.map((candidate) => candidate.email));

  const results = await Promise.allSettled(candidates.map((candidate) => AuthService.bootstrapPlatformAdmin(candidate)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, "exactly one concurrent bootstrap must succeed");
  assert.equal(results.filter((result) => result.status === "rejected").length, 1, "the second concurrent bootstrap must fail");

  const role = await admin.query("SELECT user_id FROM platform_roles WHERE role = $1", [PLATFORM_ADMIN_ROLE]);
  assert.equal(role.rowCount, 1, "only one PLATFORM_ADMIN role may exist");
  const userId = role.rows[0].user_id;
  const user = await admin.query("SELECT password_hash, system_role FROM users WHERE id = $1", [userId]);
  assert.equal(user.rows[0].password_hash, LEGACY_PASSWORD_SENTINEL, "business user row must not contain the credential hash");
  assert.equal(user.rows[0].system_role, "user", "legacy system_role must not authorize the platform admin");
  const account = await admin.query("SELECT password FROM auth_accounts WHERE user_id = $1 AND provider_id = 'credential'", [userId]);
  assert.equal(account.rowCount, 1, "Better Auth credential account must exist");
  assert.match(account.rows[0].password, /^\$2[aby]\$/, "credential must be bcrypt-hashed in Better Auth account storage");
}

async function testInvitationSingleUse() {
  const organizationId = randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  const email = `invite-${randomUUID()}@example.test`;
  createdOrganizations.push(organizationId);
  createdEmails.push(email);

  await admin.query("INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Auth Regression Invite', $2, 'active')", [organizationId, `auth-invite-${organizationId}`]);
  await admin.query("INSERT INTO organization_settings (organization_id, invitation_enabled) VALUES ($1, true)", [organizationId]);
  await admin.query("INSERT INTO organization_invitations (organization_id, email, role, token_hash, expires_at) VALUES ($1, $2, 'agent', $3, now() + interval '1 hour')", [organizationId, email, sha256(token)]);

  const accepted = await InvitationService.accept(token, { email }, { name: "Invited User", password: "VeryStrongPassword-Invite-123" });
  assert.equal(accepted.email, email);
  const membership = await admin.query("SELECT role FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2", [organizationId, email]);
  assert.equal(membership.rows[0]?.role, "agent", "invite role must come from the server-side invitation");
  const credential = await admin.query("SELECT a.password, u.password_hash FROM auth_accounts a JOIN users u ON u.id = a.user_id WHERE u.email = $1 AND a.provider_id = 'credential'", [email]);
  assert.equal(credential.rows[0]?.password_hash, LEGACY_PASSWORD_SENTINEL);
  assert.ok(credential.rows[0]?.password, "credential must be stored in auth_accounts");
  await rejectsCode(() => InvitationService.accept(token, { email }, { name: "Replay", password: "VeryStrongPassword-Replay-123" }), "INVITATION_ALREADY_ACCEPTED");
}

async function testSsoStateAndAccountLinking() {
  const organizationId = randomUUID();
  const tenantId = randomUUID();
  const clientId = randomUUID();
  createdOrganizations.push(organizationId);
  await admin.query("INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Auth Regression SSO', $2, 'active')", [organizationId, `auth-sso-${organizationId}`]);
  await admin.query(`INSERT INTO organization_settings
    (organization_id, sso_enabled, entra_tenant_id, entra_client_id, entra_client_secret_encrypted, allowed_domains, auto_join_enabled, default_auto_join_role)
    VALUES ($1, true, $2, $3, 'test-encrypted-secret', '["example.test"]'::jsonb, false, 'agent')`, [organizationId, tenantId, clientId]);

  const state = crypto.randomBytes(32).toString("base64url");
  const stateHash = sha256(state);
  await EntraAuthService.createLoginState(organizationId, stateHash, "nonce-value");
  const consumed = await EntraAuthService.consumeLoginState(stateHash);
  assert.equal(consumed.organizationId, organizationId);
  assert.equal(consumed.tenantId, tenantId);
  await rejectsCode(() => EntraAuthService.consumeLoginState(stateHash), "SSO_INVALID_STATE");

  const email = `unlinked-${randomUUID()}@example.test`;
  createdEmails.push(email);
  await admin.query("INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1, 'Unlinked User', $2, true)", [email, LEGACY_PASSWORD_SENTINEL]);
  await rejectsCode(() => EntraAuthService.resolveUserAndMembership({
    organizationId,
    providerId: `entra:${organizationId}`,
    accountId: randomUUID(),
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    email,
    name: "Unlinked User",
    idToken: "test-id-token",
    autoJoinEnabled: false,
    defaultAutoJoinRole: "agent",
  }), "SSO_ACCOUNT_LINKING_REQUIRED");

  const autoJoinEmail = `autojoin-${randomUUID()}@example.test`;
  createdEmails.push(autoJoinEmail);
  await rejectsCode(() => EntraAuthService.resolveUserAndMembership({
    organizationId,
    providerId: `entra:${organizationId}`,
    accountId: randomUUID(),
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    email: autoJoinEmail,
    name: "Unsafe Auto Join",
    idToken: "test-id-token",
    autoJoinEnabled: true,
    defaultAutoJoinRole: "admin",
  }), "SSO_INVITATION_REQUIRED");
}

async function main() {
  await admin.connect();
  try {
    const existing = await admin.query("SELECT 1 FROM platform_roles WHERE role = $1", [PLATFORM_ADMIN_ROLE]);
    assert.equal(existing.rowCount, 0, "auth regression suite requires a fresh database without an existing Platform Admin");
    await testPlatformBootstrapRace();
    await testInvitationSingleUse();
    await testSsoStateAndAccountLinking();
    console.log("Better Auth regression integration suite passed.");
  } finally {
    for (const organizationId of createdOrganizations) await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    for (const email of createdEmails) await admin.query("DELETE FROM users WHERE email = $1", [email]).catch(() => undefined);
    await admin.end();
    await closeDatabasePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
