import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("../scripts/run-biome-changed.mjs", import.meta.url),
);

test("changed-file Biome ignores unsupported inputs but rejects real errors", () => {
  const cwd = mkdtempSync(join(tmpdir(), "relvona-biome-"));
  const env = { ...process.env };
  delete env.CHANGE_TARGET;
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const run = (mode) =>
    spawnSync(process.execPath, [runner, mode], {
      cwd,
      env,
      encoding: "utf8",
    });
  try {
    git("init");
    git("config", "user.name", "CI Test");
    git("config", "user.email", "ci@example.test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(cwd, "Dockerfile"), "FROM node:22\n");
    git("add", ".");
    git("commit", "-m", "baseline");
    git("commit", "--allow-empty", "-m", "test head");
    writeFileSync(join(cwd, "Dockerfile"), "FROM node:22-alpine\n");
    for (const mode of ["lint", "format"]) {
      const result = run(mode);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }

    writeFileSync(join(cwd, "example.js"), "const value = ;\n");
    const lint = run("lint");
    assert.equal(lint.status, 1, lint.stdout + lint.stderr);

    writeFileSync(join(cwd, "example.js"), "export const value=1;\n");
    const format = run("format");
    assert.equal(format.status, 1, format.stdout + format.stderr);
    writeFileSync(join(cwd, "example.js"), "export const value = 1;\n");
    for (const mode of ["lint", "format"]) {
      const result = run(mode);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
