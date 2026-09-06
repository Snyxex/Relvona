import assert from "node:assert/strict";
import type { Response } from "express";
import { requireRole, type AuthRequest } from "../middleware/auth.js";

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
console.log("Tenant role authorization: 5 cases passed.");
