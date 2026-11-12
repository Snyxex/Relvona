import assert from "node:assert/strict";
import type { Response } from "express";
import { requirePlatformAdmin, requirePlatformPermission, requireRole, type AuthRequest } from "../middleware/auth.js";
import platformAdminRouter from "../routes/platformAdmin.js";
import { PLATFORM_PERMISSIONS, platformPermissionsForRole, type PlatformRole, type PlatformPermission } from "../services/platformRbac.js";
import { ORGANIZATION_PERMISSIONS, normalizePermissions } from "../services/organizationRbacService.js";
import { closeDatabasePool } from "../db/index.js";
import { auth } from "../auth/betterAuth.js";

function evaluate(role: string | undefined, allowed: string[]) {
  let status = 200; let passed = false;
  const req = { organization: role ? { id: "tenant-a", name: "A", slug: "a", role } : undefined } as AuthRequest;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  requireRole(allowed)(req, res, () => { passed = true; });
  return { status, passed };
}

assert.deepEqual(evaluate("viewer", ["owner", "admin", "agent"]), { status: 403, passed: false });
assert.deepEqual(evaluate("agent", ["owner", "admin", "agent"]), { status: 200, passed: true });
assert.deepEqual(evaluate("admin", ["owner"]), { status: 403, passed: false });
assert.deepEqual(evaluate("owner", ["owner"]), { status: 200, passed: true });
assert.deepEqual(evaluate(undefined, ["owner"]), { status: 403, passed: false });

function evaluatePlatformAdmin(isPlatformAdmin: boolean | undefined) {
  let status = 200; let passed = false;
  const req = { user: isPlatformAdmin === undefined ? undefined : { isPlatformAdmin } } as AuthRequest;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  requirePlatformAdmin(req, res, () => { passed = true; });
  return { status, passed };
}

assert.deepEqual(evaluatePlatformAdmin(undefined), { status: 401, passed: false });
assert.deepEqual(evaluatePlatformAdmin(false), { status: 403, passed: false });
assert.deepEqual(evaluatePlatformAdmin(true), { status: 200, passed: true });

function evaluatePermission(role: "owner" | "admin" | "agent" | "viewer", permissions: string[], method: string, originalUrl: string) {
  let status = 200; let passed = false; let body: unknown;
  const req = { method, originalUrl, organization: { id: "tenant-a", name: "A", slug: "a", role, permissions } } as AuthRequest;
  const res = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } } as unknown as Response;
  requireRole(["owner", "admin"])(req, res, () => { passed = true; });
  return { status, passed, body };
}

assert.deepEqual(evaluatePermission("admin", [], "PUT", "/api/v1/admin/settings/models"), { status: 403, passed: false, body: { error: "PERMISSION_REQUIRED", permission: "settings.manage" } });
assert.deepEqual(evaluatePermission("agent", ["settings.manage"], "PUT", "/api/v1/admin/settings/models"), { status: 200, passed: true, body: undefined });
assert.deepEqual(evaluatePermission("owner", [...ORGANIZATION_PERMISSIONS], "PUT", "/api/v1/organizations/current/role-policies"), { status: 200, passed: true, body: undefined });
assert.equal(normalizePermissions(["settings.view", "unknown.permission"]), null);
function evaluatePlatformPermission(
  role: PlatformRole | null,
  permission: PlatformPermission,
  authenticated = true,
) {
  let status = 200;
  let passed = false;
  let body: unknown;
  const req = {
    user: authenticated ? {
      platformRole: role,
      platformPermissions: platformPermissionsForRole(role),
      isPlatformAdmin: role === "PLATFORM_ADMIN",
    } : undefined,
  } as AuthRequest;
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  } as unknown as Response;
  requirePlatformPermission(permission)(req, res, () => { passed = true; });
  return { status, passed, body };
}

assert.deepEqual(evaluatePlatformPermission(null, "platform.organizations.manage", false), {
  status: 401, passed: false, body: { error: "Authentication required" },
});
assert.deepEqual(evaluatePlatformPermission(null, "platform.overview.view"), {
  status: 403, passed: false,
  body: { error: "PLATFORM_PERMISSION_REQUIRED", permission: "platform.overview.view" },
});
for (const permission of PLATFORM_PERMISSIONS) {
  assert.deepEqual(evaluatePlatformPermission("PLATFORM_ADMIN", permission), {
    status: 200, passed: true, body: undefined,
  }, "administrator retains " + permission);
}
assert.deepEqual(evaluatePlatformPermission("PLATFORM_SUPPORT", "platform.support_sessions.manage"), {
  status: 200, passed: true, body: undefined,
});
assert.deepEqual(evaluatePlatformPermission("PLATFORM_SUPPORT", "platform.organizations.manage"), {
  status: 403, passed: false,
  body: { error: "PLATFORM_PERMISSION_REQUIRED", permission: "platform.organizations.manage" },
});
assert.deepEqual(evaluatePlatformPermission("PLATFORM_AUDITOR", "platform.users.view"), {
  status: 200, passed: true, body: undefined,
});
assert.deepEqual(evaluatePlatformPermission("PLATFORM_AUDITOR", "platform.security.manage"), {
  status: 403, passed: false,
  body: { error: "PLATFORM_PERMISSION_REQUIRED", permission: "platform.security.manage" },
});

// Check all platform endpoints have a mandatory permission gate. New routes
// cannot enter this controller unnoticed.
type RouteLayer = { route?: {
  path: string;
  methods: Record<string, boolean>;
  stack: Array<{ handle: { name: string } }>;
} };
const routeLayers = (platformAdminRouter as unknown as { stack: RouteLayer[] }).stack;
const protectedRoutes = routeLayers.filter((layer) => layer.route);
assert.equal(protectedRoutes.length, 9, "review any new platform endpoint for an explicit permission");
for (const layer of protectedRoutes) {
  const route = layer.route!;
  const guards = route.stack.filter((entry) => entry.handle.name === "enforcePlatformPermission");
  assert.equal(guards.length, 1, "missing or duplicate platform permission gate on " + route.path);
}

console.log("Tenant and fine-grained platform RBAC authorization passed.");
auth.$context.then(() => closeDatabasePool()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
