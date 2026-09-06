import assert from "node:assert/strict";
import type { Response } from "express";
import { requirePlatformAdmin, requireRole, type AuthRequest } from "../middleware/auth.js";

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

function evaluatePlatformAdmin(systemRole: string | undefined) {
  let status = 200; let passed = false;
  const req = { user: systemRole ? { systemRole } : undefined } as AuthRequest;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  requirePlatformAdmin(req, res, () => { passed = true; });
  return { status, passed };
}

assert.deepEqual(evaluatePlatformAdmin(undefined), { status: 401, passed: false });
assert.deepEqual(evaluatePlatformAdmin("user"), { status: 403, passed: false });
assert.deepEqual(evaluatePlatformAdmin("superadmin"), { status: 200, passed: true });
console.log("Tenant and platform authorization: 8 cases passed.");
