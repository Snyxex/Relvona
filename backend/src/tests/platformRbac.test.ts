import assert from "node:assert/strict";
import {
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  LIMITED_PLATFORM_ROLES,
  isLimitedPlatformRole,
  normalizePlatformRole,
  platformPermissionsForRole,
} from "../services/platformRbac.js";

assert.equal(new Set(PLATFORM_PERMISSIONS).size, PLATFORM_PERMISSIONS.length);
assert.equal(new Set(PLATFORM_ROLES).size, PLATFORM_ROLES.length);
assert.deepEqual(platformPermissionsForRole("PLATFORM_ADMIN"), [...PLATFORM_PERMISSIONS]);
assert.deepEqual(platformPermissionsForRole(null), []);
assert.deepEqual(platformPermissionsForRole("PLATFORM_SUPER_USER"), []);
assert.equal(normalizePlatformRole("PLATFORM_AUDITOR"), "PLATFORM_AUDITOR");
assert.equal(normalizePlatformRole("PLATFORM_SUPER_USER"), null);
assert.equal(normalizePlatformRole({ role: "PLATFORM_ADMIN" }), null);
assert.deepEqual(LIMITED_PLATFORM_ROLES, ["PLATFORM_SUPPORT", "PLATFORM_AUDITOR"]);
assert.equal(isLimitedPlatformRole("PLATFORM_ADMIN"), false);
assert.equal(isLimitedPlatformRole("PLATFORM_SUPPORT"), true);
assert.equal(isLimitedPlatformRole("PLATFORM_AUDITOR"), true);
assert.ok(platformPermissionsForRole("PLATFORM_SUPPORT").includes("platform.support_sessions.manage"));
assert.ok(!platformPermissionsForRole("PLATFORM_SUPPORT").includes("platform.organizations.manage"));
assert.ok(!platformPermissionsForRole("PLATFORM_SUPPORT").includes("platform.users.view"));
assert.ok(platformPermissionsForRole("PLATFORM_AUDITOR").includes("platform.users.view"));
assert.ok(!platformPermissionsForRole("PLATFORM_AUDITOR").includes("platform.security.manage"));
assert.ok(!platformPermissionsForRole("PLATFORM_AUDITOR").includes("platform.support_sessions.manage"));
console.log("Platform RBAC role catalog and deny-by-default checks passed.");
