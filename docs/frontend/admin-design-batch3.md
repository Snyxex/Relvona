# Admin design migration — batch 3

This changes the **presentation** of two dense administration pages and
reuses the shared components introduced in PR #75.

## Pages
- \`/admin/analytics\`: standardized KPIs, period switcher, feedback
  discovery, knowledge-gap creation and status transitions. Existing
  7/30/90-day options and POST/PATCH endpoint contracts are preserved.
- \`/admin/agents\`: assistant selector, version publishing, Playground
  result, history and activation/rollback confirmation. Existing API
  calls, model usage warning, secret redaction and no-write Playground
  semantics are retained.

## Validation
\`frontend/tests/admin-design-batch3.test.mjs\` verifies shared components
and retained route operations in CI. Require the normal Jenkins frontend
format, lint, TypeScript, build, security and integration checks, plus a
manual browser review of narrow layouts and keyboard operation.

## Dependencies
This is a stacked draft PR:
1. PR #75 introduces the shared admin primitives.
2. PR #76 migrates quality review and SMTP settings.
3. This PR modernizes Analytics and Agent Versions.

Merge and retarget in this order. Do not merge into production before the
whole stack has passed CI. No backend, permissions, RLS, auth or database
changes are included.
