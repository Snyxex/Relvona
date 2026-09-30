# Jenkins CI/CD

## Scope and current status

`Jenkinsfile` is the primary CI definition for Relvona. It performs checkout, locked dependency installation, static checks, builds, all backend tests, PipeX and Orbis compatibility gates, dependency and secret scans, Docker/Compose validation, application smoke tests, and artifact packaging. It deliberately stops at **build + test + package**. It does not publish packages or images and does not deploy.

The existing files in `.github/workflows/` are intentionally retained until the Jenkins Multibranch job has completed successfully at least once. **Remove after first successful Jenkins build.** Before removal, configure the Jenkins status check as a required branch-protection check and compare the first Jenkins result with the mapping below.

## Detected project stack

- Node.js 22 and npm lockfile v3 for backend and frontend
- TypeScript 5, Express backend, Next.js 16 frontend, and Biome frontend lint/format checks
- PostgreSQL 16 with pgvector, Redis/BullMQ, RustFS object storage, and a separate backend worker entrypoint
- custom TypeScript test programs executed with `tsx`
- PipeX 1.0.1 from a commit-pinned public Git dependency
- Docker multi-stage images and separate base, local, production, and CI Compose definitions
- provider-neutral application AI gateway supporting configured OpenAI-compatible and other provider adapters

No Orbis package or source import exists at the time of this migration. Jenkins therefore reports the Orbis gate as not applicable. `backend/scripts/check-orbis-compat.mjs` fails closed if an Orbis dependency/import appears without a `test:orbis` script, and executes that script once it exists.

## Jenkins job

Create a **Multibranch Pipeline** with these settings:

| Setting | Value |
| --- | --- |
| Repository | `https://github.com/Snyxex/Relvona.git` |
| Script Path | `Jenkinsfile` |
| Branch source | GitHub Branch Source |
| Discover branches | Enabled |
| Discover pull requests from origin | Enabled |
| Discover pull requests from forks | Enabled only with the Jenkins trust policy described below |
| Primary trigger | GitHub webhook |

Configure the GitHub webhook for push and pull-request events. The endpoint is the Jenkins GitHub webhook URL (commonly `https://jenkins.example/github-webhook/`; use the actual controller URL). Do not use permanent SCM polling as the primary trigger.

The job cancels an older build of the same branch when a newer commit arrives. The full pipeline has a 60-minute timeout, with tighter checkout, install, AI/integration, secret-scan, and Docker-stage timeouts.

## Required plugins

- Pipeline
- Git
- GitHub
- GitHub Branch Source
- Credentials Binding (reserved for later trusted release/deployment stages)

Docker Pipeline is not required by the current file because it calls the Docker CLI directly on a Docker-labelled agent. It may be installed if the Jenkins installation standardizes agent provisioning through that plugin.

## Agent requirements

The Jenkins node label must be `docker` and provide:

- Linux with `/proc/sys/kernel/random/uuid`, POSIX shell, `tar`, and `sha256sum`
- Git
- Docker Engine with the Compose v2 plugin
- permission for the Jenkins agent identity to use Docker
- outbound HTTPS access to GitHub, npm, and the pinned container registries
- enough disk for Node dependency trees and Docker layers; at least 4 GiB RAM is recommended

Node does not need to be installed on the agent. Node commands run inside the digest-pinned `node:22-bookworm` CI service. The CI pgvector, Redis, and RustFS images are digest-pinned as well. PostgreSQL, Redis, RustFS, backend, and frontend run in a unique Compose project per build. The project uses no fixed host ports, so Multibranch jobs remain isolated.

## Pipeline stages

1. **Checkout** checks out the Multibranch revision and fetches branch/tag history for the full-history secret scan. Only this external operation is retried.
2. **Environment Validation** verifies Docker/Compose, records non-sensitive build metadata, generates random disposable CI credentials with mode `0600`, validates the CI Compose model, and reports the containerized Node/npm/Git versions.
3. **Install Dependencies** runs `npm ci` independently against the backend and frontend lockfiles. A process-only Git rewrite allows the pinned PipeX Git dependency to use HTTPS when SSH port 22 is unavailable.
4. **Quality Checks** runs backend/frontend TypeScript checks plus strict Biome lint and format checks for every frontend file changed by the current PR or push commit. The comparison base is the trusted PR target (`CHANGE_TARGET`) or the first parent on a branch build.
5. **Build** builds backend and frontend in parallel.
6. **Test Infrastructure** starts pgvector/PostgreSQL, Redis, and RustFS; then applies the real migration chain with the disposable admin connection. Tests use the non-owner application role created by that chain.
7. **Tests** runs unit, AI-engine, and security groups in parallel, followed by database/integration tests sequentially. `run-ci-tests.mjs` verifies that every `backend/src/tests/*.test.ts` file is assigned exactly once, so adding a test without placing it in a group fails CI.
8. **PipeX Validation** dynamically imports `pipex` through its public package entrypoint and verifies the public `DataEngine` and `runPipeline` exports. No private `pipex/src` path is used.
9. **Orbis Compatibility** runs the absence/presence guard described above.
10. **Dependency Audit** runs backend and frontend `npm audit --audit-level=high` in parallel. High and critical findings fail the build; there is no blanket allowlist.
11. **Secret Scan** runs digest-pinned Gitleaks against all fetched Git history using `.gitleaks.toml`, with redaction enabled. The scanner has a read-only repository mount, no network, a read-only root filesystem, no Linux capabilities, and a small isolated tmpfs.
12. **Docker Validation** validates every Compose file, builds the actual backend/frontend Dockerfiles, starts both images, and checks backend live/ready plus frontend HTTP health.
13. **Artifacts** archives backend distribution output, the Next.js standalone runtime/static files, Docker image metadata, and SHA-256 checksums. It never archives `node_modules`, dotenv files, databases, or service logs.

The unconditional post action stops containers, removes networks, volumes and locally built images for the CI project, then deletes the Jenkins workspace. Cleanup also runs after failures.

## GitHub Actions to Jenkins mapping

| Existing GitHub workflow/check | Jenkins replacement |
| --- | --- |
| `knowledge-intelligence.yml`: checkout and Node 22 setup | Checkout; Environment Validation |
| locked backend/frontend installs | Install Dependencies |
| pgvector/PostgreSQL and Redis services | Test Infrastructure |
| complete migration chain | Test Infrastructure |
| backend build | Backend Typecheck; Backend Build |
| knowledge gap/intelligence/publication/retrieval/recrawl/collection/revision tests | Integration Tests |
| assistant scope and tenant isolation tests | Integration Tests |
| frontend build | Frontend Typecheck; Frontend Build |
| `secret-scan.yml`: full checkout/ref fetch | Checkout |
| Gitleaks full-history scan | Secret Scan |

Jenkins additionally covers frontend lint/format, all other tracked backend tests, AI streaming/tool/ingestion regressions, PipeX import compatibility, Orbis detection, high-severity audits, every Compose model, Docker image builds, runtime health checks, and packaged artifacts.

## Credentials and pull-request trust

Normal CI uses no stored application, provider, registry, database, release, or deployment credential. The pipeline creates random disposable values inside the workspace solely for isolated test containers. The file is excluded from archived artifacts, never printed, and deleted in `post` cleanup.

SCM checkout credentials, if the repository becomes private, should be configured on the GitHub Branch Source and limited to repository read access. Do not expose Jenkins credentials to fork pull requests. Configure fork discovery to build untrusted revisions without trusted-file execution, or require maintainer approval according to the installed GitHub Branch Source trust strategies.

Any future registry, release, or deployment stage must satisfy all of the following:

- run only for an explicitly trusted branch or signed/reviewed `vX.Y.Z` tag;
- be excluded from change-request builds (`when { not { changeRequest() } }` plus an allowlisted branch/tag condition);
- bind the minimum credential only inside the consuming step;
- never interpolate credential values into Groovy strings or print environment variables;
- publish only after every current validation stage succeeds.

No production deployment, registry push, npm publication, database mutation, or release creation is currently active.

## Artifacts and reports

The project uses standalone TypeScript test programs rather than Jest/Vitest, so there is no native JUnit or coverage output to publish without adding a new test framework. Jenkins displays their deterministic console result and exit status. Successful builds archive:

- `relvona-backend.tgz`
- `relvona-frontend.tgz`
- `docker-images.json`
- `SHA256SUMS`

## Known quality baseline

The pre-migration frontend does not currently pass a repository-wide `npm run lint` or `npm run format:check`: the initial inventory found 70 Biome errors, 259 warnings, and 60 files with formatting differences (the local Windows result also includes CRLF normalization noise). Those issues predate this CI migration and are not silently suppressed or reclassified. The original full-project commands remain available, while Jenkins enforces the same Biome rules strictly on all files changed by a pull request or push commit. New or touched frontend code therefore cannot add to the baseline. Retire the incremental wrapper and switch Jenkins back to the full commands after a dedicated, reviewed cleanup makes both full-project checks green.

The backend audit currently reports five moderate findings and no high/critical findings. Four are the `drizzle-kit -> @esbuild-kit -> esbuild@0.18.20` development-only chain; npm proposes a breaking downgrade to `drizzle-kit@0.18.1`, so it was not applied. The remaining moderate findings are in `express@4.22.1 -> qs@6.14.2`; `body-parser` already resolves its separate `qs` copy to 6.16.0. The migration updates the independently fixable high findings (`brace-expansion`, `engine.io`) and Multer, but does not hide these moderate results. Review them when compatible upstream releases are available; the requested High/Critical gate remains enforced.

## Troubleshooting

### Checkout or PipeX installation fails

Confirm that Jenkins can reach GitHub over HTTPS and that checkout credentials have read access. The CI container rewrites only `ssh://git@github.com/` to HTTPS for the process so the commit-pinned PipeX dependency does not depend on SSH port 22. Do not work around a package problem with imports from `node_modules/pipex/src`.

### Docker permission or Compose failure

Run `docker version` and `docker compose version` as the Jenkins agent identity. Grant that identity access to the Docker daemon using the platform's normal least-privilege mechanism. Check for daemon disk exhaustion and stale resources; normal builds clean their project in `post`.

### Dependency install or audit failure

Reproduce with `npm ci` or `npm audit --audit-level=high` in the affected package. Do not regenerate a lockfile merely to bypass CI and do not silently ignore an audit finding. Record any risk acceptance with owner, rationale, scope, and expiry before implementing a narrow exception.

### Missing credentials

Normal validation should not request persistent secrets. If a future trusted release stage needs one, create a narrowly scoped Jenkins credential and bind it only in that stage. A credential request during a fork PR is a pipeline configuration error.

### Integration test failure

Inspect `docker compose --env-file .env.jenkins-ci -f docker-compose.ci.yml ps` and the failing service logs before cleanup (or temporarily preserve the workspace on a controlled diagnostic branch). Confirm that migrations completed, the application connection uses `supportai_app`, PostgreSQL/Redis/RustFS are healthy, and no other command changed the shared test schema while integration tests were running.

### Jenkinsfile validation

This repository can validate commands and Compose models locally, but authoritative Declarative Pipeline syntax validation requires the target Jenkins controller and its installed plugin versions. Before making the job required, submit `Jenkinsfile` to that controller's Pipeline Linter and complete one Multibranch build of a branch and one pull request.

## Release and deployment extension point

A future trusted flow may add `vX.Y.Z tag -> build -> test -> immutable image -> registry -> deployment`. Keep that work in distinct post-validation stages with explicit tag/branch allowlists and scoped credentials. Database migrations must remain additive and separately controlled; CI must never point at a production database.
