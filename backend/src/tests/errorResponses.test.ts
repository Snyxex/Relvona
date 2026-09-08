import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PublicRequestError } from "../utils/httpErrors.js";

const routesDir = path.resolve(process.cwd(), "src/routes");
const routeFiles = fs.readdirSync(routesDir).filter((name) => name.endsWith(".ts"));
const offenders: string[] = [];

for (const file of routeFiles) {
  const source = fs.readFileSync(path.join(routesDir, file), "utf8");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    const rawMessage = /\.status\(5\d\d\).*\.json\([^\n]*(?:error as Error|error|err)\.message/.test(line)
      || /\.status\(5\d\d\).*\.json\([^\n]*\(error as Error\)\.message/.test(line);
    if (rawMessage) offenders.push(`${file}:${index + 1}`);
  });
}

assert.deepEqual(offenders, [], `5xx responses must not expose raw exception messages: ${offenders.join(", ")}`);

const portalRoute = fs.readFileSync(path.join(routesDir, "customerPortal.ts"), "utf8");
assert.match(portalRoute, /httpOnly:\s*true/, "customer portal session cookie must remain HttpOnly");
assert.match(portalRoute, /secure:\s*process\.env\.NODE_ENV\s*===\s*["']production["']/, "customer portal session cookie must be Secure in production");
assert.match(portalRoute, /sameSite:\s*["']lax["']/, "customer portal session cookie must retain SameSite protection");
assert.doesNotMatch(portalRoute, /headers\.authorization|Bearer\\s|bearerToken\(/i, "customer portal must not accept browser bearer sessions");
assert.doesNotMatch(portalRoute, /res\.json\([^\n]*sessionToken/, "magic-link verification must not expose the portal session token in JSON");

const frontendPortal = fs.readFileSync(path.resolve(process.cwd(), "../frontend/src/app/customer-portal/page.tsx"), "utf8");
const frontendVerify = fs.readFileSync(path.resolve(process.cwd(), "../frontend/src/app/customer-portal/verify/page.tsx"), "utf8");
assert.doesNotMatch(frontendPortal, /sessionStorage|localStorage[^\n]*portal|Authorization:\s*`Bearer/i, "customer portal must not persist bearer sessions in browser storage");
assert.doesNotMatch(frontendVerify, /sessionStorage|localStorage[^\n]*portal|sessionToken/i, "portal verification page must not expose or persist a session token");
assert.match(frontendPortal, /credentials:\s*["']include["']/, "customer portal requests must include credentials");
assert.match(frontendVerify, /credentials:\s*["']include["']/, "magic-link verification must accept the HttpOnly session cookie");

const expected = new PublicRequestError("Invalid widget origin", 400, "INVALID_ASSISTANT_CONFIGURATION");
assert.equal(expected.status, 400);
assert.equal(expected.code, "INVALID_ASSISTANT_CONFIGURATION");
assert.equal(expected.message, "Invalid widget origin");
console.log(`API error-response and portal-session regression tests passed across ${routeFiles.length} route files.`);
