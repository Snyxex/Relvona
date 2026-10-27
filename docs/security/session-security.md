# Session security

## Existing behavior

- Better Auth stores sessions in `auth_sessions`; authentication middleware retrieves the session through Better Auth and calls `getSession` with `disableCookieCache: true`.
- Application endpoints recheck `users.status` and organization membership/status. Cookie security settings specify secure cookies in production and SameSite modes dependent on deployment.
- User-facing code must never copy session tokens to localStorage, sessionStorage, URLs, logs, screenshots or telemetry.
- Application CSRF origin validation covers unsafe cookie-authenticated API methods; Better Auth's own handler applies its native protections. Validate cross-origin deployment, including `trustedOrigins` sourced from verified dashboard domains.

## Missing for the requested enterprise assurance

1. Per-session `authenticatedAt`, `lastStrongAuthAt`, factor method and assurance evidence.
2. Explicit short privileged absolute/idle timeout policies, rotation on privilege change and protection from session fixation.
3. Session/device inventory, logout-all, targeted revocation and tests for immediate enforcement after deactivation.
4. Federated IDP assurance mapping with a fail-closed step-up path. A user profile flag `twoFactorEnabled` is **not** proof that a particular SSO login completed MFA.
5. Browser, cookie, proxy and CSP integration tests in representative production topology.

## Proposed acceptance cases

- Revoked or expired session immediately fails a protected request.
- Revoked owner/administrator permission cannot be used via a cached session.
- Privilege changes require a fresh, strongly authenticated session; stale sessions receive an explicit step-up challenge.
- A passkey login assertion is server-verified for correct RP ID and origin before elevation.
- Cross-tenant context and forged forwarded headers cannot grant access.
