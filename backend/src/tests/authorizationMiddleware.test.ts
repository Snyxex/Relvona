import assert from "node:assert/strict";
import type { Response } from "express";
import { requirePlatformAdmin, requireRole, type AuthRequest } from "../middleware/auth.js";
import { ORGANIZATION_PERMISSIONS, normalizePermissions } from "../services/organizationRbacService.js";

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
console.log("Tenant, platform, and organization RBAC authorization: 12 cases passed.");
