import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDatabasePool } from "../db/index.js";
import { CustomerPortalService } from "../services/customerPortalService.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required for customer portal magic-link integration tests");
const portalSecret = process.env.PORTAL_TOKEN_SECRET;
if (!portalSecret) throw new Error("PORTAL_TOKEN_SECRET is required for customer portal magic-link integration tests");

const organizationId = randomUUID();
const customerId = randomUUID();
const accountId = randomUUID();
const magicLinkId = randomUUID();
const rawToken = `${organizationId}.${crypto.randomBytes(32).toString("base64url")}`;
const tokenHash = crypto.createHmac("sha256", portalSecret).update(rawToken).digest("hex");
const admin = new pg.Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();
  try {
    await admin.query(
      "INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'Portal Magic Link Race', $2, $3)",
      [organizationId, `portal-magic-${organizationId}`, `portal-key-${organizationId}`],
    );
    await admin.query(
      "INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'portal-race@example.test', 'Portal Race')",
      [customerId, organizationId],
    );
    await admin.query(
      "INSERT INTO customer_portal_accounts (id, organization_id, customer_id, status) VALUES ($1, $2, $3, 'pending_verification')",
      [accountId, organizationId, customerId],
    );
    await admin.query(
      "INSERT INTO customer_portal_magic_links (id, organization_id, account_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, $4, 'verify', $5)",
      [magicLinkId, organizationId, accountId, tokenHash, new Date(Date.now() + 5 * 60_000)],
    );

    const results = await Promise.allSettled([
      CustomerPortalService.consumeMagicLink(rawToken),
      CustomerPortalService.consumeMagicLink(rawToken),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    assert.equal(fulfilled.length, 1, "exactly one concurrent magic-link consumption must succeed");
    assert.equal(rejected.length, 1, "exactly one concurrent magic-link consumption must be rejected");
    assert.match(String(rejected[0].reason?.message || rejected[0].reason), /Invalid or expired magic link/);

    const sessions = await admin.query(
      "SELECT id FROM customer_portal_sessions WHERE organization_id = $1 AND account_id = $2",
      [organizationId, accountId],
    );
    assert.equal(sessions.rowCount, 1, "one-time magic link must create exactly one portal session");

    const magicLink = await admin.query("SELECT used_at FROM customer_portal_magic_links WHERE id = $1", [magicLinkId]);
    assert(magicLink.rows[0]?.used_at, "magic link must be marked used after successful consumption");

    console.log("Customer portal one-time magic-link integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await admin.end();
    await closeDatabasePool().catch(() => undefined);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
