# Enterprise IAM implementation plan

Assessment date: 2026-10-27. Scope: the existing Relvona Better Auth + PostgreSQL/Drizzle system. **Implementation is incremental; no unsupported certification or full enterprise-readiness claims.**

## Prioritized implementation sequence

| Priority | Phase | Work | Current status |
| --- | --- | --- | --- |
| P0 | 1 - Assessment | Source/DB/SSO/MFA/tenant baseline, risk and compliance mapping | Implemented in docs (external review pending) |
| P0 | 2 - Auth core | Production bootstrap token, 15-char password minimum | Source implemented; Jenkins + deployment tests pending |
| P0 | 3 - SSO hardening | Entra authorization-code PKCE, encrypted single-use verifier, replay test | Source implemented; real Entra test pending |
| P0 | Dependency | Align `better-auth`, `@better-auth/drizzle-adapter` and account schema to fixed stable release | Not Implemented; migration rehearsal required |
| P1 | 3 - Strong auth | Passkeys/FIDO2, phishing-resistant privileged MFA, safe authenticator recovery | Not Implemented |
| P1 | 4 - Authorization | Explicit ABAC policies, deny-by-default permission mapping, JIT admin with per-request TTL, no self-approval | Not Implemented |
| P1 | 5 - Enterprise identity | Explicit account-linking authorization; signed SSO flows, domain validation and evaluated SAML/SCIM modules | Partially Implemented |
| P1 | 6 - Advanced | Per-session auth strength, step-up, revocation and device inventory | Partially Implemented |
| P1 | 6 - Advanced | Distributed abuse limits, privileged audit events, incident telemetry and export integrity | Partially Implemented |
| P2 | 7 - Verification | Jenkins security gates, adversarial integration/E2E tests, SAST/container/license scan | Partially Implemented |
| P2 | Compliance | DPIA, retention/erasure review, operational evidence and external audit | Requires External Review |

## Ship gates for each security milestone

1. Review source against official Better Auth APIs and migration notes; pin tested versions and never silently change core schema.
2. Provide reproducible negative tests for unauthorized/expired/replayed requests, race conditions, and tenant boundary checks.
3. Run full Jenkins PR pipeline on disposable PostgreSQL/Redis; verify frontend+backend builds, migration, actual integration tests and secret scan. Do not use GitHub Actions.
4. For SSO, validate against a controlled Microsoft Entra test tenant, including error/recovery paths. For MFA/passkeys, test genuine authenticator flows and assurance claims.
5. Document end-user changes, deployment/rollback instructions, residual risk and security review sign-off.
6. Merge only once gates relevant to that phase are passed.

## Explicit no-go decisions

No new parallel auth store, no fake passkey endpoints, no self-issued tokens as substitutes for Better Auth, no trusting a `twoFactorEnabled` profile flag as proof of current session assurance, no JavaScript-executed arbitrary access policy, and no automatic promotion based on an email domain.
