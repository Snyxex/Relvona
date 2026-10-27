# Authentication policies

## Implemented baseline and phase 1

- Better Auth is the central authentication engine. Public signup is disabled; users are provisioned by platform bootstrap, organization invitation or approved Entra flows.
- New passwords and passphrases must contain **15–128 Unicode code points**. Password fields support pasting and password managers; there are no character-class rules. Existing credentials remain usable; enforcement occurs on new/password-changing flows, not at sign-in.
- Existing hashes use bcrypt cost 12 via Better Auth's documented custom hash/verify extension. Argon2id calibration is a proposed later migration, not an implemented feature.
- Better Auth Two Factor provides TOTP and backup codes; platform policy defaults to `recommended`. **Privileged-user MFA is not uniformly mandatory yet**. A global required-policy check exists but does not prove a phishing-resistant factor for federated sessions.
- New initial platform administration in production requires `PLATFORM_BOOTSTRAP_TOKEN` (>=32 characters). Generate at least 32 cryptographically random bytes, deliver privately to the installer and remove/revoke it after successful bootstrap.
- Entra custom SSO uses Authorization Code + S256 PKCE, server-generated state and nonce, tenant-specific issuer/audience JWT verification and bounded login-state lifetime; run a staged IdP compatibility test before activation.

## Not implemented / further controls

1. Privacy-preserving breached-password detection for all new password and reset paths, ideally supported by updated Better Auth.
2. Passkey/WebAuthn registration, login, strong device binding and recovery.
3. Default privilege-aware enrollment and per-session step-up evidence; avoid describing TOTP as phishing-resistant.
4. Hardened secure email-change confirmation and account-recovery workflows with adversarial tests.
5. Session/device inventory and reauthentication before password/MFA/role/key administration.
6. Controlled SSO account linking instead of the existing first-time match by email + membership/invitation.
7. Better Auth and Drizzle adapter release update to patched stable versions after account-schema migration rehearsal.

## Deployment notes

All authentication secrets are injected via environment or secret manager; never include them in frontend builds. Keep Better Auth session cookies HttpOnly and secure in production, validate reverse-proxy trust boundaries, and verify that Redis-backed application rate limits cannot be bypassed by forged client IP headers.
