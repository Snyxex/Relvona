# Tenant RLS coverage: storage and knowledge evidence

The 2026-11-27 inventory identified tenant-owned tables that had `organization_id`
but were missing from the central `enableRls.ts` policy list. The normal
application login had broad table grants, so endpoint-level filters alone
were insufficient defense in depth.

This change enables and forces tenant RLS on:

- `file_objects`
- `knowledge_source_revisions`
- `file_attachments`
- `exports`

The policy requires the transaction-local `app.organization_id` value for
both reads and writes. No tenant context means no visible tenant-owned rows.

## CI verification

`tenantRlsCoverage.integration.test.ts` runs against the same **disposable**
database as the other destructive integration tests. It checks that the app
role is neither a superuser, `BYPASSRLS`, a role creator nor a table owner
(or a member of a table-owner role). It enumerates PostgreSQL's live tables
with `organization_id` / `tenant_id`, validates `ENABLE` and `FORCE`
RLS with a tenant policy, and performs cross-tenant SELECT/UPDATE/DELETE
and a forbidden INSERT for the four storage/evidence tables.

A newly created tenant table without a corresponding policy must fail CI.

## Remaining P0: authentication bootstrap boundary

This is **not** a claim of full tenant isolation. Five tables are explicitly
excluded from the RLS coverage gate because existing code accesses them
before the organization context is established:

- `organization_members`: login/membership and active-organization selection
- `organization_dashboard_domains`: verified host resolution before authentication
- `organization_invitations`: invitation lookup/acceptance at login
- `platform_support_sessions`: privileged support-session discovery
- `sso_login_states`: OIDC/Entra callback state lookup

These tables still require narrow, audited pre-auth resolver functions and
tenant policies; their exception is **temporary and a release blocker**,
not approval for unrestricted reads. Avoid enabling generic tenant RLS on
them without first refactoring the bootstrap flows, or login/SSO may fail.

Additional remaining work: review all privileged SECURITY DEFINER functions,
cross-tenant foreign key references, worker/job and S3 authorization, and
negative tenant tests for the full API surface. A green storage test does
not establish the global tenant isolation Go-live gate.
