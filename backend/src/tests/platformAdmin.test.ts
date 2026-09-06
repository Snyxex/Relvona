import assert from "node:assert/strict";
import { requirePlatformAdmin, type AuthRequest } from "../middleware/auth.js";
import type { Response } from "express";

for (const role of [undefined, "user", "admin", "owner", "superadmin"]) {
  let status = 200;
  let passed = false;
  const req = { user: role ? { systemRole: role } : undefined, organization: { role: "owner" } } as AuthRequest;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  requirePlatformAdmin(req, res, () => { passed = true; });
  assert.equal(passed, role === "superadmin");
  assert.equal(status, role === undefined ? 401 : role === "superadmin" ? 200 : 403);
}
console.log("Platform administrator authorization: 5 cases passed.");
