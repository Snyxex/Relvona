# Authentication/IAM security control matrix

**Baseline:** 2026-10-27. This is an engineering gap assessment, **not** a declaration of ASVS conformance, GDPR legal compliance, ISO certification or SOC 2 attestation.

| Reference | Requirement | Implementation / evidence | Test | Status |
| --- | --- | --- | --- | --- |
| OWASP ASVS 5.0 L2 | Cryptographically strong session with server validation | Better Auth DB sessions; cookie cache bypass; auth middleware | `authRegression.integration.test.ts` (partial) | Partially Implemented |
| NIST SP 800-63B-4 | Password-only minimum, long passphrases | Phase-1 >=15 and <=128 new credentials; existing credential hashing bcrypt 12 | `bootstrapGuard.test.ts` | Partially Implemented |
| NIST SP 800-63B-4 | Breached-password screening | Pending Better Auth upgrade and supported API verification | Not written | Not Implemented |
| FIDO2 / WebAuthn | Phishing-resistant passkeys and user verification | No configured Passkey plugin | Not written | Not Implemented |
| NIST SP 800-63 | Session assurance/step-up | 2FA plugin and policy exist; no per-session AAL/step-up evidence | Needs actual factor-flow tests | Partially Implemented |
| OAuth 2.0 RFC 9700 / RFC 7636 | Code flow with PKCE, state and nonce | Custom Entra issuer/audience/nonce; phase-1 S256 PKCE | `entraPkce.test.ts`, `authRegression.integration.test.ts` | Implemented (verification pending Jenkins/real IdP) |
| OWASP ASVS V2 | Controlled first-admin bootstrap | Single-use advisory lock and phase-1 production token | `bootstrapGuard.test.ts` | Implemented (verification pending Jenkins) |
| OWASP ASVS V4 | RBAC and tenant-aware resource authorization | Organization member and RBAC middleware, tenant RLS | `tenantIsolation.integration.test.ts` | Partially Implemented |
| OWASP API Security / BOLA | No cross-tenant access | Per-request org membership, RLS and negative tests | `customerToolIsolation.integration.test.ts` | Partially Implemented |
| NIST SP 800-53 AC | JIT privilege expiry and four-eyes approval | No complete JIT grant and approval engine | Not written | Not Implemented |
| OWASP ASVS V3 | Strong MFA and secure recovery | Better Auth TOTP and backup-code support; policy recommended by default | Partial security/auth tests | Partially Implemented |
| OWASP API Top 10 | Distributed rate limiting | Application Redis token bucket; Better Auth own guards require separate review | `security.test.ts` | Partially Implemented |
| OWASP ASVS V7 | Audit events and integrity | Tenant audit logs exist; tamper-evident security export not proven | Partial event tests | Partially Implemented |
| GDPR Art. 5/25/32 | Data minimization, retention and user rights | Existing models and technical boundaries | Requires DPIA/retention verification | Requires External Review |
| ISO/IEC 27001/27002 | Security management system, evidence and audit | Technical controls and this gap register | External organizational evidence | Requires External Review |
| SOC 2 TSC | Governance and independent assurance | No attestation evidence | External audit | Requires External Review |
| Supply-chain security | Vulnerability, license, secret and container scans | Jenkins builds/audit/Gitleaks; not all requested scanners deployed | Jenkins runtime evidence needed | Partially Implemented |

## Evidence status vocabulary

- **Implemented:** source code or configuration exists, but does not by itself prove production effectiveness.
- **Verified:** relevant automated test and outcome have been observed.
- **Partially Implemented:** some controls exist; critical subrequirements remain.
- **Not Implemented:** no safe implementation exists yet.
- **Requires External Review:** operator, compliance/legal or auditor action is required.

No new phase-1 changes are marked Verified until Jenkins reports their actual test results and the Entra integration is exercised against a controlled test tenant.
