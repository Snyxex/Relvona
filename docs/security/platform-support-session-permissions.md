# Read-only platform support sessions

A platform administrator may open a documented, time-limited support session
to inspect an organization to which they do not belong. The session must not
silently inherit tenant administrator privileges.

For requests authenticated using a valid X-Support-Session-Id, the tenant
context exposes only a fixed set of *.view permissions and role viewer.
The effective permissions are **not** read from the tenant-configurable
viewer-role policy. GET and HEAD are permitted; all other request methods
fail with SUPPORT_SESSION_READ_ONLY (HTTP 403).

Real active organization memberships continue to take precedence. An owner
visiting their own organization retains their normal permissions even when
a support-session header is included. A platform administrator without
membership and without a valid, unexpired, owner-bound support session remains
unauthorized.

## Compatibility

Support sessions are intentionally **read-only** after this change. Existing
flows that previously performed tenant mutations through a support session
must use normal membership-based authorization or a separately reviewed,
narrowly scoped privileged action. Avoid restoring generic admin rights.

The existing authentication and initial support-session creation API are
unchanged. No database migration is required. Integration tests cover session
ownership, expiration, termination, malicious tenant viewer-policy overrides,
read access, mutation denial, and normal owner membership.
