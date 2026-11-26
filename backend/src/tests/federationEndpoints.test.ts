import assert from "node:assert/strict";
import { federationPlugin } from "../auth/federationPlugin.js";
import { closeDatabasePool } from "../db/index.js";
async function run() {
  const endpoints = federationPlugin().endpoints;
  const context = { baseURL: "https://relvona.example/api/auth" };
  const start = await endpoints.startOidc({
    params: { organizationId: "invalid" },
    context,
    asResponse: true,
  } as never);
  assert.equal(start.status, 302);
  assert.match(
    start.headers.get("location") || "",
    /#sso_error=SSO_START_FAILED$/,
  );
  const callback = await endpoints.oidcCallback({
    query: {},
    context,
    asResponse: true,
  } as never);
  assert.equal(callback.status, 302);
  assert.match(
    callback.headers.get("location") || "",
    /#sso_error=SSO_LOGIN_FAILED$/,
  );
  const login = await endpoints.ldapLogin({
    body: { organizationId: "invalid" },
    context,
    headers: new Headers(),
    asResponse: true,
  } as never);
  assert.equal(login.status, 401);
  console.log(
    "Federation invalid organization, callback and LDAP request handling passed",
  );
}
run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);
