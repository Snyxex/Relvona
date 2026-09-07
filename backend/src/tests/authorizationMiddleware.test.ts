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
console.log("Tenant and platform authorization: 8 cases passed.");
