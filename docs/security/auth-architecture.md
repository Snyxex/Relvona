# Relvona authentication and IAM architecture

**Assessment:** 2026-10-27 · **Status:** Partially Implemented. This describes the current source and the phase-1 changes, not an externally audited or production-verified environment.

## Current trust boundaries

- **Browser ↔ API:** Next.js authenticates with the Better Auth browser client; credentials and session identifiers are not kept in localStorage. Express mounts Better Auth at `/api/auth/*` and uses `getSession({ query: { disableCookieCache: true } })` when authorizing application API requests.
- **API ↔ PostgreSQL:** Better Auth uses the configured Drizzle adapter with existing PostgreSQL tables `users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, and `auth_two_factors`. The application enforces tenant-scoped RLS for tenant tables with an active organization context. Auth/session tables require separate access controls because a user may belong to several tenants.
- **Organizational access:** Organization membership is independently looked up on the server. Permissions are resolved from `organizationRbacService`; support teams, owner/admin/agent/viewer and global `platform_roles` are separate application concepts. Better Auth Organization plugin is **not** currently the source of truth; do not add it in parallel without migration design.
- **MFA:** Better Auth Two Factor plugin provides TOTP and backup codes, with application-wide `platform_security_settings`. Current policy defaults to `recommended`, so privileged MFA enforcement and assurance-sensitive step-up are not yet complete.
- **Entra SSO:** Custom Better Auth endpoint accepts Microsoft Entra ID sign-ins. It validates tenant-bound issuer/audience/nonce, stores single-use state, restricts domains, and resolves organization membership. Phase 1 adds RFC 7636 S256 PKCE. A randomly generated verifier is encrypted at rest, associated with a one-time state, and sent only to Microsoft's token endpoint. It must not be logged.
- **Initial administrator:** The public platform bootstrap API is one-time and uses an advisory lock. Phase 1 additionally requires `PLATFORM_BOOTSTRAP_TOKEN` (minimum 32 characters) in production, supplied in `X-Platform-Bootstrap-Token`. No token is persisted in the database.

## Auth library and migration warning

Installed/declared dependency baseline is Better Auth 1.7.2 and `@better-auth/drizzle-adapter` 1.7.2. Their 1.7.7 patch line fixes upstream security advisories affecting certain enabled flow combinations. This application does **not** currently enable every affected upstream plugin; actual exploitability must be evaluated per configuration. Nevertheless, upgrading both packages together to a current patched stable release is a **required dependency-hardening task**, not part of this PKCE schema change.

**Important:** Upgrading from Better Auth 1.7.0–1.7.2 to 1.7.3+ may require the official `auth_accounts.issuer` schema cleanup. This project currently declares `issuer` NOT NULL and stores issuer values. Do not blindly change the version or run `drizzle-kit push` in production without a tested, reversible account-schema migration. Maintain existing user identifiers and sessions.

## Remaining design work

1. Secure, explicit SSO account linking for existing local accounts and robust IdP-initiated and sign-in recovery flows.
2. Authentication-strength and session-recentness records for actual step-up decisions across password, TOTP, passkey and federated login.
3. Passkeys/WebAuthn with RP ID/origin validation, recovery and privileged enrollment.
4. ABAC policies for fine-grained resources; JIT privilege grants with per-request expiry and independent approval.
5. Privileged session revocation, security event exports, audited retention and privacy operations.
6. Schema and deployment review of account/session tables; staged Better Auth upgrade.

Do not interpret the existence of a plugin as completed NIST AAL2/AAL3, an OWASP ASVS pass, ISO certification, or SOC 2 attestation.
