import assert from "node:assert/strict";
import { oidcRequest } from "../auth/oidcHttp.js";
async function run() {
  for (const url of [
    "http://example.com",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "https://127.0.0.1",
    "https://169.254.169.254",
  ])
    await assert.rejects(() => oidcRequest(url));
  console.log(
    "OIDC insecure URL, embedded credential, loopback and metadata requests blocked",
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
