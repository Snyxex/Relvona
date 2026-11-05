# IAM security testing and evidence

## How to run

Relvona uses **Jenkins only**. The repository's `Jenkinsfile` invokes `backend/scripts/run-ci-tests.mjs` and fails if any backend `src/tests/*.test.ts` is not classified. No GitHub Actions workflows are used.

For a disposable local PostgreSQL/Redis environment set the test-scoped variables described in `docs/jenkins.md`; do not run destructive auth regression tests against production. Then:
```sh
npm --prefix backend ci
npm --prefix backend run build
npm --prefix backend run test:ci:unit
AUTH_REGRESSION_DESTRUCTIVE_TESTS=true npm --prefix backend run test:ci:integration
```

## Phase-1 tests added

| Test | Property | Outcome |
| --- | --- | --- |
| `entraPkce.test.ts` | RFC 7636 S256 vector, randomness and invalid-verifier rejection | Source added; Jenkins result pending |
| `authRegression.integration.test.ts` | One-time consumption of state and encrypted verifier | Source expanded; Jenkins result pending |
| `bootstrapGuard.test.ts` | Production missing-token denial, constant-time matching, new-password boundaries | Source added; Jenkins result pending |

The existing auth regression test requires `AUTH_REGRESSION_DESTRUCTIVE_TESTS=true` and `DATABASE_ADMIN_URL` to point at a **disposable** database. Jenkins's non-owner app role is used for tenant tests and its admin role only for scoped schema setup.

## Required additional coverage

- Controlled Entra tenant full authorization-code + PKCE flow (positive and code-verifier mismatch), invalid origin and tenant, nonce replay and state expiration.
- TOTP enrollment/disable/recovery-code replay, passkey sign-in/registration and privileged step-up bypass.
- Credential stuffing, concurrent one-time token redemptions, account linking and session revocation.
- Failed authentication events and audit-log privacy, role and tenant privilege escalation, CSRF, SSO redirect validation.
- Dependency audit, SAST, container scan and license controls under Jenkins; don't assert these are all implemented yet.

## Test reporting

Keep **Implemented**, **Verified**, **Partially Implemented**, **Not Implemented**, and **Requires External Review** distinct. Build passes are not equivalent to penetration testing, ASVS certification or independent audits.
