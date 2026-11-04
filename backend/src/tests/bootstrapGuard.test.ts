import assert from "node:assert/strict";
import { isBootstrapTokenAuthorized } from "../auth/bootstrapGuard.js";
import { requireNewPasswordPolicy } from "../auth/password.js";

// Synthetic fixture only; no credential or externally issued token is used here.
const token = `bootstrap-test-only-${"a".repeat(40)}`;
assert.equal(isBootstrapTokenAuthorized(token, token, true), true);
assert.equal(isBootstrapTokenAuthorized(token.slice(0, -1) + "a", token, true), false);
assert.equal(isBootstrapTokenAuthorized(undefined, token, true), false);
assert.equal(isBootstrapTokenAuthorized(token, undefined, true), false, "production requires token configuration");
assert.equal(isBootstrapTokenAuthorized(token, "short", true), false);
assert.equal(isBootstrapTokenAuthorized("x".repeat(513), token, true), false);
assert.equal(isBootstrapTokenAuthorized(undefined, undefined, false), true, "local development is supported");
assert.equal(isBootstrapTokenAuthorized("wrong", token, false), false, "configured development token must be enforced");
assert.doesNotThrow(() => requireNewPasswordPolicy("a".repeat(15)));
assert.doesNotThrow(() => requireNewPasswordPolicy("a".repeat(64)));
assert.doesNotThrow(() => requireNewPasswordPolicy("a".repeat(128)));
assert.throws(() => requireNewPasswordPolicy("a".repeat(14)), /INVALID_PASSWORD_POLICY/);
assert.throws(() => requireNewPasswordPolicy("a".repeat(129)), /INVALID_PASSWORD_POLICY/);
assert.throws(() => requireNewPasswordPolicy(null), /INVALID_PASSWORD_POLICY/);
console.log("Platform bootstrap and password policy tests passed");
