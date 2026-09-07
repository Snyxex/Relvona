import assert from "node:assert/strict";
import { assertActiveDirectoryUrlAllowed, isValidActiveDirectoryUrl, isValidDistinguishedName } from "../services/activeDirectoryService.js";

async function run() {
  assert.equal(isValidActiveDirectoryUrl("ldaps://dc01.example.internal:636"), true);
  assert.equal(isValidActiveDirectoryUrl("ldap://dc01.example.internal:389"), false);
  assert.equal(isValidActiveDirectoryUrl("ldaps://user:password@dc01.example.internal"), false);
  assert.equal(isValidActiveDirectoryUrl("ldaps://dc01.example.internal/path"), false);
  assert.equal(isValidDistinguishedName("DC=example,DC=internal"), true);
  assert.equal(isValidDistinguishedName("not-a-dn"), false);

  const previousAllowPrivate = process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS;
  delete process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS;
  try {
    await assert.rejects(() => assertActiveDirectoryUrlAllowed("ldaps://127.0.0.1:636"));
    await assert.rejects(() => assertActiveDirectoryUrlAllowed("ldaps://169.254.169.254:636"));
    await assert.rejects(() => assertActiveDirectoryUrlAllowed("ldaps://dc01.example.internal:636"));
    process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS = "true";
    await assert.doesNotReject(() => assertActiveDirectoryUrlAllowed("ldaps://127.0.0.1:636"));
  } finally {
    if (previousAllowPrivate === undefined) delete process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS;
    else process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS = previousAllowPrivate;
  }

  console.log("Active Directory configuration validation and outbound policy: 10 cases passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
