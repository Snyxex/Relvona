# Global platform audit for privileged changes

Relvona's `audit_logs` table is tenant-scoped by design and must not be used
for role assignments or global security settings. The new `platform_audit_logs`
table records platform-wide operations, without a tenant ID.

## Required events

- `platform.role.granted`: limited operator role and full administrator grants
  through the restricted CLI services.
- `platform.role.revoked`: limited role revocations.
- `platform.security.two_factor_policy.changed`: authenticated global 2FA
  policy changes, including actor UUID, optional bounded IP and user agent.

Role events include the affected user UUID and old/new role, but never user
passwords or authorization tokens. No-op grants/revokes do not write events.
Each mutation, session invalidation and required audit insert shares a single
database transaction. If audit insertion fails, no privilege mutation commits.

CLI attribution records the OS account and hostname (`unix:user@host`). This
identifies the execution identity **not necessarily the human operator**.
Shell access, sudo/auditd traces and peer approval must remain restricted to
associate CLI use with people. The full platform administrator bootstrap path
and any direct SQL mutations must undergo separate coverage review.

## Database access boundaries

`db:migrate` creates the table using an additive, idempotent migration before
`enableRls.ts`. The app database role receives **INSERT only**.
The table has forced RLS and only an INSERT policy for that role.
No tenant-facing API can read the global history. DBA-only investigation
should use restricted database administrator credentials; never grant platform
audit SELECT access to the general tenant application role.

This is an append-only *application* contract, not cryptographic immutability.
Database owners and superusers can still modify history. External tamper-evident
export/retention and auditing bootstrap role creation are future hardening tasks.

## Verification

`platformGlobalAudit.integration.test.ts` runs only on disposable PostgreSQL.
It verifies actual changed vs idempotent role events, full admin CLI grants,
transaction rollback on a forced audit failure, policy-change logging, and
inability of the application DB role to read/delete global history.

No frontend changes, token leakage, API route expansion, or tenant RBAC grants.
