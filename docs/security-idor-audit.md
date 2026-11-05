# IDOR/BOLA prevention: API authorization contract

**Status:** Security review in progress. This document records checked code paths and required acceptance criteria, not a certification or a claim that all routes have been audited.

## Security invariant

A client can always edit an HTTP path, query parameter, body, or header. The application **must not** infer authorization from a hidden/unguessable ID. Identity must come from a verified session or API-key principal. Organization access must be resolved from active membership (or a separately authorized and unexpired platform support session). Every referenced resource must be checked against that authorized scope.

For self-service endpoints such as `/api/v1/auth/me`, use `req.user.id` exclusively. Reject client-supplied `id`, `userId`, `user_id`, `accountId`, and `account_id` parameters on those endpoints. This branch adds that explicit guard; the existing handlers were already using the authenticated session user.

## Verified by source inspection, not by runtime tests

- `backend/src/routes/auth.ts`: `GET /me` and avatar/preferences mutations use `req.user.id`. `GET /organizations` is filtered by the authenticated user ID.
- `backend/src/middleware/auth.ts`: `tenantContext` checks organization membership before constructing the organization context; a platform admin without membership must supply an authorized, unexpired support session tied to both the admin user and target organization.
- `backend/src/routes/organizations.ts`: current organization endpoints derive organization ID from authenticated tenant context.
- `backend/src/routes/customers.ts`: customer detail lookup and deletion require both resource ID and authenticated organization ID.
- `backend/src/routes/tickets.ts`: ticket comment timeline now checks that its parent ticket exists in the authenticated organization before returning children.
- `backend/src/routes/conversations.ts`: timeline, handoff, and message endpoints now check the parent conversation exists in the current organization before reading or mutating nested records.
- `backend/src/services/customerPortalAttachmentService.ts`: portal ticket attachments were already restricted by organization, session customer ID, ticket ID, attachment ID, `CUSTOMER_VISIBLE` status, and ready storage objects. The signed download URL remains a bearer capability until expiration.
- `backend/src/services/customerPortalService.ts`: portal session account/customer joins and linked visitor conversation joins now explicitly enforce the same authenticated organization ID, in addition to existing tenant-scoped predicates.
- `backend/src/routes/attachments.ts`: internal attachment list, upload binding, download and deletion already use an authenticated organization; upload finalization binds the initiating user, parent and visibility. Staff deletion additionally checks administrative role or uploader ownership.

This is **not** a complete route/service/database audit. Platform administration, customer-portal authentication, integrations, RAG retrieval, attachments, user/member administration, and nested resource references require separate review.

## Required authorization rules

1. Never accept `userId`, `organizationId`, role, `isAdmin`, or similar fields as an authority claim. Some APIs legitimately accept **target resource identifiers**, but those identifiers require explicit membership, role, ownership, and relationship checks.
2. For tenant-owned records, use a combined predicate: `id = requestedId AND organizationId = authorizedOrganizationId`. On nested operations, verify the parent record belongs to the same tenant too.
3. For user-private data, check subject ownership (`userId = req.user.id`), unless a documented, audited administrator permission explicitly allows a broader scope.
4. Check authorization **before** updating, deleting, uploading/downloading, or invoking side effects. For writes, enforce scope in the actual write query or transaction as well to avoid time-of-check/time-of-use races.
5. Validate relational IDs (`customerId`, `conversationId`, `assignedAgentId`, `sourceId`, etc.) against the same tenant and expected relationship, not just their format.
6. Prefer consistent `404` for inaccessible resource IDs to avoid exposing cross-tenant existence. Use `403` when appropriate for an authenticated principal whose role does not allow the operation.
7. PostgreSQL RLS is defense in depth; do not substitute it for application-level authorization. Never let a client set the trusted database tenant/session role directly.
8. API key context and platform support sessions require their own explicit scope and expiration checks. Log denied access without recording sensitive request bodies or secrets.
9. Avoid unrestricted mass assignment: accept only allowlisted writable fields and never update ownership/role/organization columns from arbitrary request objects.

## Must-run negative tests once the test environment is available

For every GET/PATCH/PUT/POST/DELETE route with an ID or nested ID, check: same-user/same-tenant allowed; other user's private record denied; other tenant's record denied; forged `x-organization-id` denied without membership; revoked/inactive membership denied; unauthorized role denied; nonexistent record denied; body-based `userId`/`organizationId` override ignored or rejected; nested cross-tenant IDs denied; foreign resource updates produce no side effects. Include API-key and platform support-session variants.

Run checks against a disposable PostgreSQL database with RLS enabled **and** against a privileged test connection to confirm that application authorization does not depend only on RLS. Do not merge or deploy broad authorization changes before those checks pass.

## Follow-up priorities

1. Enumerate all route parameters and service methods; produce a complete ID-to-scope matrix.
2. Review object-storage signed URL TTL, public accessibility, and revocation strategy; URL recipients can access an issued bearer link until it expires even if the application session is revoked.
3. Complete customer portal and attachment authorization integration tests, including cross-tenant account/customer relationships and mixed-owner parent IDs.
4. Audit every cross-resource write with tenant-filtered foreign key lookups and transactional mutations.
5. Add integration regression coverage for normal users, admins, inactive members, and cross-tenant adversarial ID changes.

No claim of comprehensive IDOR prevention should be made until that work and its negative tests are complete.
