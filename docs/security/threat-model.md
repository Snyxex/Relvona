# Relvona IAM threat model

**Scope:** Public authentication/API routes, initial organization bootstrap, local credentials, Entra federation, session/tenant selection, privileged operations and CI supply chain. **Method:** STRIDE-inspired enumeration, as of 2026-10-27. Review again after each new IdP/passkey/admin feature.

| Boundary / asset | Threat scenario | Existing or phase-1 mitigation | Residual risk / owner |
| --- | --- | --- | --- |
| First platform owner creation | Unauthenticated attacker claims uninitialized public installation | One-time locked bootstrap; production-only secret bootstrap token and rate limits | Token must be generated out of band, protected and discarded; operator to verify public exposure |
| SSO authorization response | OAuth authorization-code interception or request substitution | Entra state, nonce, signed ID token validation; **phase-1 S256 PKCE** and atomic single-use state | Cross-region clock drift, IdP behavior and migration must be integration-tested with real Entra tenant |
| Identity linking | Attacker proves an email within an IdP but links to an unrelated local user | Entra issuer/tenant/domain validation and membership/invitation checks | **High-priority open:** existing-email linking lacks explicit reauthentication/consent; review before broadening SSO |
| Password material | Credential stuffing or weak passphrase | Better Auth, bcrypt cost 12, protected DB and Redis rate limit, 15-character minimum on new passwords | Breached-password candidate screening, Argon2id calibration and legacy upgrades open |
| Session cookie | Session fixation, theft, stale roles, CSRF | HttpOnly cookie via Better Auth, secure cookie in prod, Origin check, server-side membership refresh and cookie cache bypass | Actual login strength, privileged reauth, per-device revocation and long-lived cookie policy need tests |
| Multi-tenancy | User switches header to a foreign organization | Organization membership check and forced PostgreSQL tenant RLS on tenant tables | Check service-role bypasses, platform support impersonation, raw SQL, and unscoped queries |
| Privilege grants | Stolen low-privilege session requests admin permission | Role/permission middleware and separate platform admin role | JIT grants, two-person approval, step-up and deny-by-default policy catalogue not complete |
| Password resets / invitations | Replay, race or email enumeration | Invitation tokens are hashed, expiry and row lock; Better Auth reset hooks | Verify email delivery integration, concurrent reset redemption, and public-response uniformity |
| Service/API credentials | Secret leaks through logs, build artifacts or database snapshots | Encrypted provider settings, Jenkins Gitleaks, no GitHub Actions | Legacy plaintext token rows and offsite backup encryption must be verified |
| Auth framework dependencies | Upstream vulnerable 1.7.2 Better Auth code exposed via newly enabled plugin | Restricted plugin set; maintenance via Jenkins dependency audit | **Open:** lockfile update to patched Better Auth release and account-issuer schema migration |
| Abuse/rate limiting | Attacker rotates source IP or forges proxy headers | Redis-backed atomic token bucket for application endpoints | Express `trust proxy = 1` requires deployment topology validation; ensure origin cannot be directly bypassed |

## Highest-priority tasks

P0: upgrade Better Auth after migration rehearsals; protect the public bootstrap path; validate Entra PKCE. P1: explicit SSO account linking, privileged authentication-strength enforcement, trusted proxy topology, session/device controls. P2: passkeys, JIT admin, SIEM and privacy retention. Risks are **open** until a test and an operational owner confirm mitigation.

## Review procedure

For each security change record: entry point, principal, organization, expected authorization, negative case, rate limit, audit event, failure mode, migration path, and test evidence. Never put credentials, complete session tokens, TOTP secrets or personal customer data in test fixtures or incident reports.
