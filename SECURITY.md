# Relvona Security Policy & Architecture

## Reporting a vulnerability

Please do **not** report security vulnerabilities through a public GitHub issue.

Use GitHub's private vulnerability reporting / repository security advisory flow for Relvona when available. Include a clear description, affected component, reproduction steps or proof of concept, impact, and any suggested mitigation.

Do not include production credentials, customer data, or other third-party secrets in a report.

## Security architecture overview

Relvona follows a zero-trust approach to AI components. Large language models and retrieved content are treated as untrusted inputs. Authentication, authorization, tenant isolation, administrative permissions, and sensitive actions are enforced by deterministic server-side code and PostgreSQL controls rather than by model instructions.

```text
User Input -> Rate Limiting & Validation -> Better Auth Session/API Key -> Tenant-Scoped Retrieval -> Delimited Untrusted Context -> AI Gateway -> Output Safety -> Client
```

## Key security controls

### Multi-tenant isolation

- Tenant context is derived from authenticated server-side identity.
- Tenant-owned data is scoped by organization.
- PostgreSQL row-level security is used for tenant-owned records where implemented.
- Vector retrieval is tenant-scoped rather than global.

### Prompt injection and RAG poisoning defenses

- Retrieved knowledge is treated as untrusted data.
- Retrieved content is separated from trusted system instructions.
- Ingestion can identify suspicious prompt-injection patterns for review.
- Tool execution does not rely on arbitrary model output alone; tool inputs are validated before execution.

### Web crawler SSRF protection

- Outbound crawl targets are restricted to approved HTTP/HTTPS destinations.
- Private, loopback, link-local, metadata, reserved, and local network targets are blocked.
- Redirect targets are revalidated.
- Response size, content type, redirect count, and request duration are bounded.

### File upload validation

- Uploads are size-limited.
- Filenames are sanitized and storage keys are generated independently of user-supplied paths.
- Supported document types are validated before processing.
- Uploaded content is stored outside directly executable/public application paths.

### Secrets and credentials

- Provider and integration credentials are encrypted at rest where supported by the platform.
- Production secrets must be injected at runtime and must not be committed to Git.
- `.env` variants and common private-key/credential formats are ignored by repository rules.
- The repository contains a Gitleaks configuration for secret scanning.

### Authentication and API keys

- Dashboard authentication uses server-side Better Auth sessions.
- Public widget identifiers are not treated as dashboard credentials.
- Organization API keys are designed to be stored as hashes rather than recoverable plaintext.
- Login, registration, public widget, and API traffic are subject to rate limiting.

### Authorization and sensitive actions

- Organization roles are checked server-side.
- Platform administration is separated from ordinary tenant administration.
- Sensitive AI tool actions can require explicit approval.
- Stored tool requests are revalidated before execution.

### Audit logging

Privileged operations can be written to persistent audit logs with actor and request metadata. Logs must not contain raw secrets, authentication tokens, or unnecessary customer content.

### Public widget abuse controls

- Public widget traffic is rate-limited.
- Browser origins can be restricted per deployment/assistant configuration.
- Tenant AI budgets provide an additional spend/abuse boundary.
- Conversation access is scoped using signed or otherwise server-verified session context.

### Scale-out controls

- Redis is used for shared rate-limit, queue, and realtime coordination where configured.
- Background ingestion and processing use queue workers rather than long-running request handlers.
- Similarity search uses pgvector indexes while tenant filters remain mandatory.

### Observability and health

- OpenTelemetry instrumentation is available for traces and operational telemetry.
- Structured logs should contain correlation/operational metadata rather than secrets or unnecessary customer message content.
- Liveness and readiness endpoints are available for deployment health checks.

### Privacy and retention

- PII redaction is applied to supported AI/ingestion workflows before external model processing where configured.
- Customer deletion workflows are designed to remove customer-owned support records through relational cascades.
- Retention, provider configuration, backups, and external integrations remain the responsibility of the deployment operator.

## Supported versions

Relvona is currently under active development. Security fixes are applied to the current `main` branch unless a release policy states otherwise.

## Deployment responsibility

Self-hosting operators are responsible for secure production configuration, including TLS, network isolation, unique secrets, backups, provider credentials, database permissions, object-storage permissions, dependency updates, monitoring, and access controls.

See:

- [`docs/security.md`](docs/security.md)
- [`docs/privacy-architecture.md`](docs/privacy-architecture.md)
- [`docs/production-operations.md`](docs/production-operations.md)

## Disclosure

Please allow reasonable time for investigation and remediation before publicly disclosing a confirmed vulnerability. Coordinated disclosure is preferred.
