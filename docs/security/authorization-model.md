# Authorization model

## Current source of truth

- Global platform administrators are looked up via the `platform_roles` table, not a client-controlled session property.
- Organization membership and status are read from PostgreSQL on each request via `getOrganizationMembership`; request-supplied `x-organization-id` is only a selector, never an authorization grant.
- Application permissions are derived by `organizationRbacService`; `requireRole` or `requirePermission` checks protected API operations. Verify each new router is explicitly permission-mapped (otherwise `requireRole` can fall back to role names).
- PostgreSQL forced Row-Level Security applies to tenant tables with `app.organization_id` set in the request's tenant context. Do not enable bypass-RLS database credentials on public-facing services.
- Temporary platform support access is distinct from actual organization membership; audit scope and expiry separately.

## Policies to add

| Planned protected operation | Default requirement | Step-up / conditions |
| --- | --- | --- |
| View own sessions | Current authenticated user | No cross-user session access |
| Revoke another user's session | Tenant security administrator | Fresh authentication and audit |
| Modify tenant roles | Owner / explicit `members.manage` policy | Fresh strong authentication; deny self-escalation |
| Create API keys or rotate secrets | Explicit administrative permission | Reauthenticate, minimal scopes, immutable audit |
| Manage identity providers | Owner + IdP management permission | Step-up, domain verification, dual approval if high impact |
| Request JIT privileged access | Authenticated eligible staff | Justification, ticket, bounded scope, no self-approval |
| Approve JIT request | Independent eligible approver | Proof of strong authentication and no conflicting interests |
| Execute JIT action | Active approved grant | Verify expiration and resource scope on **each** request |
| Break glass | Named emergency custodian | Offline-controlled access, alert, time limit, retrospective review |

**Open:** Better Auth Organization/Access Control plugins are not currently the sole policy source. Do not introduce a second conflicting membership model. Design any dynamic role or ABAC migration with a one-time mapping and negative tests.

## Verification

Existing `tenantIsolation.integration.test.ts`, `authorizationMiddleware.test.ts` and `authRegression.integration.test.ts` provide partial evidence. Dedicated JIT, session-freshness and cross-tenant elevated-operation tests are still required.
