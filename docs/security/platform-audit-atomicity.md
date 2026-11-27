# Atomic auditing for platform tenant operations

The following privileged platform-admin mutations now persist their business
change and required audit record in one PostgreSQL transaction:

- PATCH /api/v1/platform-admin/organizations/:id/status
- POST /api/v1/platform-admin/support-sessions
- POST /api/v1/platform-admin/support-sessions/:id/end

The transaction establishes the target organization's context with
withTenantTransaction before writing to the forced-RLS audit_logs table.
An audit insertion failure aborts and rolls back the mutation. Each record
contains the authenticated actor ID, action, resource ID, source IP and a
bounded user agent. Support-session starts include the operator's reason and
the chosen expiration time.

The API endpoints remain protected by authenticate and requirePlatformAdmin.
Platform administrators do not gain implicit tenant membership. Support
sessions remain time-limited, reason-bearing and owned by their creator.

## Integration tests

The disposable-PostgreSQL suite platformOperationsAudit.integration.test.ts
checks that mutations and audit entries commit atomically, that another user
cannot terminate a session, that repeated termination emits no extra event,
that forced RLS prevents unscoped reads, and that an audit FK failure rolls
back a status update.

## Remaining limitations

A dedicated global audit stream has been added for operator role
assignments/revocations and the global two-factor policy, separate from this
organization-scoped audit table. See `platform-global-audit.md`. Bootstrap
administration and other legacy best-effort calls still require coverage
review. This original tenant-audit change itself required no migration;
the separate global-audit change introduces an additive database table.
