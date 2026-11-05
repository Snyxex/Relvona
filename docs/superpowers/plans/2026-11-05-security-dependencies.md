# Backend dependency security update

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the nine known moderate npm audit findings and deploy the verified backend to the existing test server.

**Architecture:** Keep direct application dependency versions and application behavior unchanged. Override the vulnerable esbuild nested beneath @esbuild-kit/core-utils with patched 0.25.12, and the pinned gaxios beneath gcp-metadata with compatible 7.3.1, which removes the rimraf/glob/minimatch dependency chain. Retain prior server images and configuration for rollback.

**Tech Stack:** npm, Node.js 22, TypeScript, Docker Compose, PostgreSQL/pgvector, Redis, RustFS.

**Spec:** User request to update the reported vulnerable packages on relvona.snyxe.de.

## Tasks

- [x] Update backend/package.json with narrowly scoped overrides and regenerate backend/package-lock.json; verify npm audit including development dependencies.
- [x] Validate a clean dependency install, backend build, existing unit/security tests, and esbuild loader/gaxios compatibility.
- [x] Build uniquely tagged backend and migration images on the server without changing the live containers.
- [x] Test migrations and authentication against an isolated database; run tenant isolation checks.
- [x] Back up the current deployment, retain rollback images/configuration, and deploy the verified backend and worker without rerunning migrations on the live database unless needed.
- [x] Verify running image versions, health, authentication gates, signed storage, and a fresh audit; document results and limitations.

## Evidence and decisions

- Fresh npm ci using the final lockfile: zero known vulnerabilities. Existing package versions other than gaxios are unchanged; 62 obsolete package entries were removed.
- npm retained a stale nested esbuild entry until that generated lockfile subtree was regenerated. A temporary deduplication experiment changed unrelated packages and was discarded; the final lockfile preserves their original entries.
- Independent review found no blocking issues and requested real loader/migration and mocked metadata checks.
- Work remains in the existing checkout; no branch, commit, or unrelated source changes are needed for this dependency-only update.

- Local backend build, 19 unit-test files, and both security-test files (including 34 security assertions) pass with the final clean install.

- Node.js 22 server image: existing unit/security groups pass; full npm audit including dev dependencies reports zero findings. Dedicated smoke checks pass for synchronous CommonJS and asynchronous ESM TypeScript transformations, gaxios success/error responses, and instance/project metadata requests through gcp-metadata.
- Both replacement images built successfully. The initial isolated migration test used the application connection for one DDL script; the test harness was corrected to use the admin connection for migration and the application connection only for runtime/auth/RLS tests. No application code or live schema was changed.

- Isolated migration, tenant isolation and Better Auth regression suite all passed after correcting the test harness.
- A full pre-deployment backup was created. The initial attempt automatically rolled back because the older server curl rejected --retry-all-errors; the checker now uses Python with a bounded timeout. The second deployment succeeded.
- Public URL/authentication gates, existing owner bootstrap state, WebSocket handshake, and signed HTTPS object upload/download all passed after rollout. The fresh audit executed in the running backend completed with exit 0 and zero known vulnerabilities. Prior images/configuration and a rollback script are retained.
