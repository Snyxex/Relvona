# Security and Privacy

SupportAI processes customer conversations, organization knowledge, integration credentials, and AI provider configuration. Security therefore has to be enforced at several layers rather than relying on one control.

## Tenant isolation

SupportAI is multi-tenant. Organization-owned data is scoped by server-derived organization context.

PostgreSQL row-level security is used as a second isolation layer for tenant-owned tables. Production application connections should use the non-owner application database role rather than the migration/admin role.

## Authentication and authorization

Internal dashboard access uses authenticated sessions. Organization roles such as owner, admin, agent, and viewer restrict privileged operations.

Sensitive administration areas, including integration configuration, require elevated roles.

The customer portal and website widget use separate customer-facing access mechanisms and do not grant access to the internal dashboard.

## Secrets

Never commit real credentials to Git.

The repository ignores `.env` files, `.env.*` variants, private-key formats, credential files, and similar secret material while allowing documented example templates.

Production deployments should inject secrets at runtime from a secret manager such as Infisical. Provider keys, integration credentials, signing secrets, database passwords, and application encryption keys must never be embedded into frontend bundles or container images.

A Gitleaks configuration is included for repository secret scanning.

## Encrypted credentials

Provider and integration credentials are encrypted before storage. Encryption secrets must be independent from authentication/session secrets and should support controlled rotation.

## AI tool execution

AI-requested tools are not executed from arbitrary model output without validation.

Tool input is validated against the registered tool schema. Unexpected fields, invalid formats, invalid enum values, and out-of-range numeric values can be rejected before execution.

Sensitive actions can require explicit approval. This creates a boundary between AI reasoning and externally visible side effects.

## Prompt injection and RAG

Knowledge sources are treated as untrusted reference material. Retrieved text cannot be allowed to replace higher-priority system instructions.

The RAG flow should keep tenant context server-derived and avoid giving retrieved content control over tool authorization, secrets, or system behavior.

## PII and secret redaction

Customer messages may contain sensitive information. SupportAI includes redaction-oriented handling for categories such as credentials, API keys, JWTs, password assignments, payment-card data, email addresses, and phone numbers before sensitive data can spread to logs, embeddings, or provider calls where applicable.

Do not intentionally use the support widget to collect passwords, authentication tokens, payment credentials, or other secrets.

## Streaming safety

Streaming AI responses require the same safety controls as buffered responses. Output filtering and buffering are used to reduce the chance that sensitive or instruction-like material is streamed before it can be checked.

## Upload security

File uploads must be treated as untrusted input. Upload controls include size/type validation and application-level checks before content is processed or exposed.

Object-storage credentials must remain server-side. Customer downloads should go through controlled application workflows or short-lived authorized URLs rather than making storage buckets public.

## SSRF protection

Website ingestion and integrations can cause the server to make outbound requests. Those paths must block unsafe targets such as private/internal address ranges when the feature is intended for public URLs.

Do not weaken outbound-network validation to make a single integration easier to configure.

## Rate limiting and quotas

Public and sensitive endpoints use rate limiting to reduce abuse.

AI usage can also be constrained through tenant token budgets. When budgets are exhausted, the application can avoid calling the provider and move the conversation to a human-support path instead.

## Request limits

HTTP body sizes must remain bounded. Large unauthenticated payloads can otherwise become a denial-of-service vector even before authentication logic runs.

## CORS and browser security

Production CORS configuration should list only the required dashboard origins. Do not use a wildcard for authenticated production access.

Widget deployments should use a restrictive Content-Security-Policy on the host website and should never embed provider keys or internal secrets.

## Database and Redis exposure

PostgreSQL and Redis should not be reachable from the public internet. In Docker deployments they belong on private/internal networks, with only the application services able to reach them.

## Logging and telemetry

Logs should include operational identifiers such as request IDs, job IDs, tenant IDs, conversation IDs, and trace IDs when useful.

Logs should not include passwords, provider credentials, session tokens, raw authorization headers, secrets, or unnecessary full customer message bodies.

## Webhooks

Inbound webhooks are external attack surfaces. Use signature verification or equivalent authentication, strict payload validation, bounded body sizes, tenant-safe routing, and idempotency where repeated delivery is possible.

## Repository hygiene

Before releases, run a repository secret scan across all refs/history rather than checking only the current working tree.

Typical release checks should include:

```bash
gitleaks git --redact --no-banner
npm --prefix backend audit --omit=dev --audit-level=critical
npm --prefix backend run test:security
```

Adapt these commands to the release environment and installed tooling.

## Incident response

If a secret may have been exposed:

1. revoke or rotate the credential first;
2. determine which service and tenants could have been affected;
3. inspect logs without copying the secret into tickets or chat systems;
4. rotate dependent credentials when required;
5. remove the secret from current source and, when appropriate, rewrite Git history;
6. notify affected stakeholders according to the organization's incident process.

Deleting a secret from the latest commit does not invalidate a credential that has already been exposed.

## Further reading

- [Privacy architecture](privacy-architecture.md)
- [Production operations](production-operations.md)
- [Object storage](object-storage.md)
