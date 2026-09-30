import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const backendPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const frontendPackage = JSON.parse(readFileSync(new URL("../../frontend/package.json", import.meta.url), "utf8"));
const dependencyNames = [backendPackage, frontendPackage].flatMap((manifest) => [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
]);

function sourceUsesOrbis(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (sourceUsesOrbis(path)) return true;
    } else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) {
      const source = readFileSync(path, "utf8");
      if (/from\s+["'](?:@orbis|orbis)|import\s*\(\s*["'](?:@orbis|orbis)/i.test(source)) return true;
    }
  }
  return false;
}

const integrated = dependencyNames.some((name) => /(^|[/@-])orbis([/-]|$)/i.test(name))
  || sourceUsesOrbis(fileURLToPath(new URL("../src/", import.meta.url)))
  || sourceUsesOrbis(fileURLToPath(new URL("../../frontend/src/", import.meta.url)));

if (!integrated) {
  console.log("Orbis is not integrated; compatibility smoke test is intentionally not applicable.");
  process.exit(0);
}

if (!backendPackage.scripts?.["test:orbis"]) {
  throw new Error("Orbis integration detected, but backend package.json has no test:orbis compatibility smoke test");
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", "test:orbis"], {
  cwd: new URL("../", import.meta.url),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
