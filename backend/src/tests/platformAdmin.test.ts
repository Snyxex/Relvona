import assert from "node:assert/strict";
import { requirePlatformAdmin, type AuthRequest } from "../middleware/auth.js";
import type { Response } from "express";
import { closeDatabasePool } from "../db/index.js";
import { auth } from "../auth/betterAuth.js";

for (const isPlatformAdmin of [undefined, false, true]) {
  let status = 200;
  let passed = false;
  const req = { user: isPlatformAdmin === undefined ? undefined : { isPlatformAdmin }, organization: { role: "owner" } } as AuthRequest;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  requirePlatformAdmin(req, res, () => { passed = true; });
  assert.equal(passed, isPlatformAdmin === true);
  assert.equal(status, isPlatformAdmin === undefined ? 401 : isPlatformAdmin ? 200 : 403);
}
console.log("Platform administrator authorization: 3 cases passed.");
auth.$context.then(() => closeDatabasePool()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
