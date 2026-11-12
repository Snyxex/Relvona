# Platform RBAC — Phase 1 API enforcement

Platform permissions are **not** organization permissions. They are derived
on every authenticated API request from the database-backed \`platform_roles\`
row. Unknown roles have no permissions; no token claim, organization role,
legacy \`users.system_role\` or caller-supplied header may grant platform access.

## Initial built-in profiles

| Role | Permissions | Intended scope |
| --- | --- | --- |
| PLATFORM_ADMIN | All permissions in the catalog | Full platform administrator |
| PLATFORM_SUPPORT | platform.overview.view, platform.organizations.view, platform.support_sessions.manage | Operational support sessions; cannot suspend tenants or change global security |
| PLATFORM_AUDITOR | platform.overview.view, platform.organizations.view, platform.users.view, platform.security.view | Read-only platform review |

Permission catalog:
- platform.overview.view
- platform.organizations.view
- platform.organizations.manage
- platform.users.view
- platform.security.view
- platform.security.manage
- platform.support_sessions.manage

Every route under \`/api/v1/platform-admin\` has explicit permission
middleware; no boolean administrator fallback. The new
\`GET /api/v1/platform-admin/access\` returns the effective role/permissions
for the authenticated operator.

The legacy \`isPlatformAdmin\` and \`systemRole\` response fields remain
for compatibility and only identify full PLATFORM_ADMIN accounts.
The existing \`/admin\` Next.js UI deliberately remains full-admin-only:
it also hosts tenant configuration pages. Scoped roles can use only the
explicitly authorized API endpoints until a separate role-aware operations
interface has been implemented.

## Operator-only provisioning

**Never expose these commands through a public API.** Run only from an
approved operational shell with restricted database credentials:

\`\`\`sh
cd backend
npm run build
node dist/scripts/manageLimitedPlatformRole.js grant support@example.test PLATFORM_SUPPORT
node dist/scripts/manageLimitedPlatformRole.js grant auditor@example.test PLATFORM_AUDITOR
node dist/scripts/manageLimitedPlatformRole.js revoke support@example.test
\`\`\`

Existing accounts only. Grant rejects disabled users and refuses role
replacement (including PLATFORM_ADMIN); repeat grants are idempotent.
Revoke refuses PLATFORM_ADMIN. Successful changes increment the token
version and invalidate Better Auth sessions in the same transaction.
The separate \`grantPlatformAdmin.js\` remains the full administrator path.
The platform role table remains unique per user.

**Audit limitation:** This CLI does not yet have a platform-wide
append-only audit stream; existing tenant-scoped audit cannot correctly
represent global user access. Restricted shell access, execution logs and
change review remain required until the platform-wide audit PR is completed.

## Testing

The CI suite covers the permission catalog, explicit route gates,
grant/revoke idempotency, session revocation, support-session least privilege
and role conflicts. Database tests run against disposable PostgreSQL.
No database schema migration is required.
