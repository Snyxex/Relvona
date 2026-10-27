# IAM operations and migration runbook

## Initial platform bootstrap (production)

1. Before exposing a fresh installation, generate at least 32 bytes of cryptographically secure random data, e.g. `openssl rand -base64 48`.
2. Store the result as `PLATFORM_BOOTSTRAP_TOKEN` in the server-side environment or secret manager. Never commit it, paste it into issue trackers or place it in a public compose file.
3. Start with HTTPS and a restricted setup endpoint; enter the same token in `/setup/platform-admin`.
4. After the first platform owner exists, remove/rotate the token in the deployment and restart affected instances. The existing advisory lock prevents further bootstrap claims.
5. Monitor any 403 `PLATFORM_BOOTSTRAP_NOT_AUTHORIZED` attempts without logging supplied token values.

Development without a configured token remains supported when `NODE_ENV != production`. Do not operate public-facing development environments.

## Entra PKCE roll-out

1. Back up PostgreSQL. Rehearse on a staging database and verify all data/session migrations and the new nullable `sso_login_states.pkce_verifier_encrypted` column before deploying code.
2. Validate encryption keys (`ENCRYPTION_SECRET_CURRENT` or supported rotated prior key) match on all nodes. PKCE verifier is encrypted with the same key management mechanism as existing provider secrets.
3. Deploy all backend instances in a coordinated cutover; requests initiated before migration without PKCE must be restarted. The callback rejects a consumed state without an encrypted verifier.
4. Validate authorization URL contains `code_challenge_method=S256` and token exchange contains `code_verifier` without logging either sensitive value.
5. Test login using a controlled Microsoft Entra tenant, including invalid state, nonce, issuer/audience, incorrect code and replay; inspect sanitized audit logs.
6. Roll back only using a tested schema/application pair. PKCE state/nonce entries are ephemeral (10 minutes) and may safely be expired; do not resurrect consumed requests.

## Better Auth dependency upgrade: required separate release

- **Current baseline:** Better Auth + Drizzle adapter declared `1.7.2`. Relevant upstream fixes are present by `1.7.7`; choose a vetted stable release and update packages in lockstep using `npm ci`-reproducible lockfiles.
- **Critical migration trap:** 1.7.0–1.7.2 added `auth_accounts.issuer`; 1.7.3+ restored older core account schema. This repo currently defines a required issuer column. Consult the official 1.7 account-schema upgrade guide and back up/verify the uniqueness constraints; then use a reversible, explicitly tested migration. Never drop a required/unique column blindly.
- On staging, validate sign-in, invitations, existing sessions, TOTP, custom Entra account linking, tenant isolation and Better Auth adapter schema checks. Do not enable unreviewed SSO/SCIM or Magic Link plugins.
- Coordinate all nodes, active login requests and rotation as required by the selected release. After the successful rollout monitor login errors, API 401/403, and audit anomalies.
- Rollback must include both compatible database schema and application artifacts and must not reintroduce known exploitable configurations.

## Operational security checklist

| Item | Owner action |
| --- | --- |
| Trusted reverse proxies | Restrict ingress; validate Express `trust proxy` and Cloudflare/Traefik forwarded-IP topology |
| MFA | Define privileged policy and strong federated assurance mapping; block bypass during recovery |
| Secret storage | Restrict server-side keys, implement rotation and verify encrypted backup/restore |
| Jenkins pipeline | Require successful Jenkins PR check, build, integration tests, dependency/secret scan and artifact checks |
| Incident handling | Use `incident-response.md`; avoid exposing credentials in logs |
| Compliance | Collect independent evidence and keep `compliance-matrix.md` updated |

**Phase 1 is not production-approved until a real Jenkins run and controlled Entra SSO test succeed.**
