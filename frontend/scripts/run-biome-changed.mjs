import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);

const mode = process.argv[2];
if (mode !== "lint" && mode !== "format")
  throw new Error(`Unsupported Biome mode: ${mode ?? "<missing>"}`);

const target = process.env.CHANGE_TARGET;
if (target && !/^[A-Za-z0-9._/-]+$/.test(target))
  throw new Error("CHANGE_TARGET contains unsupported characters");
const base = target ? `origin/${target}` : "HEAD^";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.split("\0").filter(Boolean);
}

const changed = git([
  "diff",
  "--relative",
  "--name-only",
  "--diff-filter=ACMR",
  "-z",
  base,
  "--",
  ".",
]);
const untracked = git([
  "ls-files",
  "--others",
  "--exclude-standard",
  "-z",
  "--",
  ".",
]);
const files = [...new Set([...changed, ...untracked])].filter((path) =>
  existsSync(path),
);

if (files.length === 0) {
  console.log(`No changed frontend files to ${mode}.`);
  process.exit(0);
}

console.log(`Biome ${mode} base: ${base}`);
console.log(files.join("\n"));
const biomeEntrypoint = require.resolve("@biomejs/biome/bin/biome");
const result = spawnSync(process.execPath, [biomeEntrypoint, mode, ...files], {
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
