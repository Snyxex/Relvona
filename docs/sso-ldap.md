# LDAP and OpenID Connect sign-in

Open **Administration > Anmeldung & SSO** for the selected organization.
The existing Entra integration remains available separately. Each organization
can configure one additional OIDC provider and one LDAP directory.

## Authentik / Keycloak / other OIDC providers

Create a confidential OpenID Connect client with Authorization Code, PKCE S256
and `client_secret_post` authentication. Copy the redirect URI displayed by
Relvona exactly. Configure `openid profile email` scopes and an asymmetric
signing key (RS256, PS256 or ES256). The ID token must contain `sub`, `email`,
`email_verified: true`, `iat`, `exp` and the requested `nonce`.

For Authentik, use the application-specific issuer, for example
`https://auth.example.com/application/o/relvona/`. The discovery document is
loaded beneath that issuer. Configure email verification in the provider rather
than marking unverified addresses as verified. See the
[Authentik OAuth2/OIDC documentation](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/).

Enter the issuer, client ID, secret, display name and allowed email domains.
Existing encrypted secrets are retained when their input is left empty.
Provider endpoints must use HTTPS on the issuer's origin; redirects are rejected.
Private provider hosts require an explicit deployment allowlist:
`OIDC_ALLOWED_PRIVATE_HOSTS=auth.example.internal` (comma-separated hostnames).
TLS verification always remains enabled. Network requests pin validated DNS
results, time out and limit response size.

Users need an existing active organization membership or an unexpired invitation.
Automatic organization joining is disabled for generic OIDC. Identity is bound to
the issuer, client, organization and subject. State is single-use, expires after
10 minutes and is bound to a signed browser cookie and configuration fingerprint.
Signatures, issuer, audience, authorized party, timestamps, nonce, verified email
and allowed domains are checked before a session is created.

## LDAP / Active Directory

Use LDAPS on port 636 with a trusted TLS certificate. Configure the service bind
DN/password and search base DN. Active Directory searches use userPrincipalName,
mail or sAMAccountName and exclude disabled accounts. Generic LDAP searches use
inetOrgPerson with uid or mail. Users enter their full company email address;
that address must identify the directory record. A service bind and an unambiguous
search are followed by a user bind. Empty passwords are rejected. Relvona never
stores the user's directory password.

LDAP users must already have an active Relvona account and active organization
membership. LDAP does not provision accounts or assign roles. Deployment policy
must explicitly permit private directories through
`ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS=true`. Internal CA certificates can be
provided through Node's `NODE_EXTRA_CA_CERTS`; do not disable certificate checks.

## Login and MFA

Open **Mit Firmenkonto anmelden (SSO / LDAP)** on the sign-in screen and enter the
organization UUID shown in the administration page. Use the SSO button or enter
the directory email/password. Organization identifiers are not secrets. Do not
share client secrets or bind passwords with users.

For accounts with local MFA enabled, external authentication creates only a
short-lived Better Auth two-factor challenge; the normal session is created after
the existing TOTP verification. Platform MFA enrollment policy remains enforced
by the existing API guards. OIDC-provider MFA alone is not interpreted as local
MFA enrollment. LDAP and OIDC have dedicated rate limits in addition to global
limits. Local login remains available for recovery.

## Deployment and verification

Run the existing database schema setup before starting the new backend:
`npm --prefix backend run db:migrate` (check the repository deployment workflow).
This adds oidc_configuration, ldap_directory_type and the SSO-state provider
column without changing existing Entra states. No live schema migration is run by
the implementation task.

Local tests cover configuration/claim policy, LDAP filtering/binds and existing
LDAPS endpoint policy; backend and frontend builds must pass. Full callback,
invitation persistence, MFA-cookie exchange and real directory/provider acceptance
also require the project's disposable-database integration environment and a
configured identity provider. Unit tests and builds do not establish live readiness.
SAML, SCIM provisioning and provider-initiated logout are not implemented.
