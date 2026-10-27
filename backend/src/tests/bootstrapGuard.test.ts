import assert from "node:assert/strict";
import { isBootstrapTokenAuthorized } from "../auth/bootstrapGuard.js";

const token = "VnMc-U6N2B4jxg5XcBSZa8xKD5qP9Y21KZgaFsW7mZk";
assert.equal(isBootstrapTokenAuthorized(token, token, true), true);
assert.equal(isBootstrapTokenAuthorized(token.slice(0, -1) + "a", token, true), false);
assert.equal(isBootstrapTokenAuthorized(undefined, token, true), false);
assert.equal(isBootstrapTokenAuthorized(token, undefined, true), false, "production requires token configuration");
assert.equal(isBootstrapTokenAuthorized(token, "short", true), false);
assert.equal(isBootstrapTokenAuthorized("x".repeat(513), token, true), false);
assert.equal(isBootstrapTokenAuthorized(undefined, undefined, false), true, "local development is supported");
assert.equal(isBootstrapTokenAuthorized("wrong", token, false), false, "configured development token must be enforced");
console.log("Platform bootstrap guard tests passed");
