import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicRequestError } from "../utils/httpErrors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.resolve(here, "../routes");
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
const expected = new PublicRequestError("Invalid widget origin", 400, "INVALID_ASSISTANT_CONFIGURATION");
assert.equal(expected.status, 400);
assert.equal(expected.code, "INVALID_ASSISTANT_CONFIGURATION");
assert.equal(expected.message, "Invalid widget origin");
console.log(`API error-response regression tests passed across ${routeFiles.length} route files.`);
