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


test("changed-file Biome excludes upstream-only changes after target advances", () => {
  const cwd = mkdtempSync(join(tmpdir(), "relvona-biome-diverged-"));
  const env = { ...process.env, CHANGE_TARGET: "main" };
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
    git("checkout", "-b", "main");
    // Deliberately unformatted on the PR side, but this file was not changed
    // by the PR: an upstream-only correction must never enter the file list.
    writeFileSync(join(cwd, "upstream-only.js"), "export const upstream=1;\n");
    writeFileSync(join(cwd, "feature.js"), "export const feature = 1;\n");
    git("add", ".");
    git("commit", "-m", "shared baseline");
    git("checkout", "-b", "feature");
    writeFileSync(join(cwd, "feature.js"), "export const feature = 2;\n");
    git("add", ".");
    git("commit", "-m", "PR feature");
    git("checkout", "main");
    writeFileSync(join(cwd, "upstream-only.js"), "export const upstream = 1;\n");
    git("add", ".");
    git("commit", "-m", "unrelated upstream fix");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "feature");

    for (const mode of ["lint", "format"]) {
      const result = run(mode);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /feature\.js/);
      assert.doesNotMatch(result.stdout, /upstream-only\.js/);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
