# Pre-tenant invitation and SSO state RLS

Normal tenant operations on `organization_invitations` and
`sso_login_states` now use enforced PostgreSQL RLS with
`app.organization_id`.

Two bootstrap operations cannot know the organization before looking up
their capability token:

1. Invitation acceptance resolves the SHA-256 hash of the randomly generated
   invitation token. `InvitationService.getActive` sets
   `app.invitation_token_hash` using `set_config(..., true)` within a
   database transaction before selecting the matching invitation.
2. Entra OIDC callback atomically consumes one-time SSO state.
   `EntraAuthService.consumeLoginState` sets `app.sso_state_hash`
   transaction-locally and performs the matching update in the same
   transaction. Creation is tenant-scoped.

The additional policies permit reads (and SSO state consumption) for
**only the exact SHA-256 token hash** supplied in that transaction;
without either tenant context or matching state hash they expose no rows.
The invitation secret and Entra state remain bearer capabilities and must
retain high entropy, strict expiry, rate limits and no logging.

This protects against accidental unscoped ORM access, not a malicious
application process with full SQL execution. The application DB account
can itself assign these custom GUCs; the tenant context and capability
hash are therefore defense-in-depth, not cryptographic DB-role separation.

Existing auth-regression integration tests exercise acceptance, replay
denial and encrypted PKCE state; additional negative DB reads/updates
assert that direct unscoped access cannot obtain them.

Remaining bootstrap tables needing dedicated work:
`organization_members`, `organization_dashboard_domains`, and
`platform_support_sessions`. Do not claim full tenant isolation until
those and the full worker/API/file-storage paths are verified.
