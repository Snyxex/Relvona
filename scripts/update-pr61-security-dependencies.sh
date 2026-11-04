#!/usr/bin/env bash
# One-time dependency remediation for PR #61.
# Run from the repository root on a workstation/CI maintenance host with npm registry access.
# Does not push, merge, change a live database, or suppress audit failures.
set -euo pipefail

test -f backend/package-lock.json && test -f frontend/package-lock.json || {
  echo "Run this script from the Relvona repository root." >&2
  exit 1
}
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has changes. Commit or stash them before updating." >&2
  exit 1
fi
branch="$(git branch --show-current)"
if [[ "$branch" != "security/iam-phase1-entra-pkce-20261027" ]]; then
  echo "Refusing to update dependencies outside PR #61 branch (current: $branch)." >&2
  exit 1
fi

echo "Updating security-sensitive packages and npm lockfiles."
echo "WARNING: Better Auth 1.7.3+ may change the issuer column of auth_accounts."
echo "Only apply the resulting changes to production after testing schema migration"
echo "on a disposable clone of the existing database and verifying sessions/account linking."
echo
# Do not use npm audit fix --force: upgrades must be reviewed and tested.
npm --prefix backend install --package-lock-only --save-exact \
  better-auth@1.7.16 @better-auth/core@1.7.16 @better-auth/drizzle-adapter@1.7.16 multer@2.5.0
npm --prefix frontend install --package-lock-only --save-exact \
  better-auth@1.7.16 next@16.4.5

# Resolve non-breaking transitive fixes where permitted by declared ranges.
npm --prefix backend audit fix --package-lock-only || true
npm --prefix frontend audit fix --package-lock-only || true

echo
echo "Inspect all changes, run npm ci, typechecks, builds, and auth regression tests."
echo "The high-severity npm audits MUST pass before a merge; unresolved advisories"
echo "(notably Zod major-version and drizzle-kit transitive dependencies) require"
echo "their own reviewed updates. The next Jenkins build remains the source of truth."
echo
git diff --stat -- backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
npm --prefix backend audit --audit-level=high || true
npm --prefix frontend audit --audit-level=high || true
