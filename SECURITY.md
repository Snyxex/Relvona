# Security Policy & Architecture

## Security Architecture Overview

The AI Customer Support Platform is built on a **Zero-Trust AI Architecture**. The Large Language Model (LLM) is treated as an untrusted third-party component. Authentication, authorization, tenant isolation, and administrative permission checks are strictly enforced by deterministic server-side code in Node.js/Express and PostgreSQL.

```
User Input ──► Rate Limiting & Validation ──► Better Auth Session/API Key ──► Tenant-Scoped Vector Search ──► Tag-Delimited Prompt ──► LLM Gateway ──► Output Sanitization ──► Client
```

---

## Key Security Controls

### 1. Multi-Tenant Vector Search Isolation
- Every vector query (`1 - (embedding <=> query_vector)`) is hardcoded with `WHERE organization_id = authenticated_tenant_id`.
- Vector similarity searches never execute globally.
- Tenant context is derived strictly from server-side authenticated sessions or verified API keys.

### 2. Prompt Injection & RAG Poisoning Shielding
- Retrieved knowledge chunks are wrapped in XML tags (`<retrieved_knowledge_untrusted>`).
- System prompts instruct models that context contains UNTRUSTED DATA and instructions inside retrieved documents must never be executed.
- Text content is pre-scanned during upload for poisoning patterns (e.g. `ignore previous instructions`, `reveal system prompt`, `output admin password`). Suspicious sources are marked `SUSPICIOUS` in database.

### 3. Web Crawler SSRF Prevention
- URLs are limited to HTTP/HTTPS, all DNS A/AAAA answers are checked, and the validated IP is pinned for the outbound connection to prevent DNS rebinding.
- Loopback, private, link-local/cloud-metadata (`169.254.169.254`), CGNAT, documentation, multicast, reserved IPv4 and local IPv6 ranges are blocked. `localhost`, `.local`, and `.internal` names are blocked.
- Redirects are manual, limited to three hops, and each target is resolved and checked again. Responses must be HTML/plain text, finish within ten seconds, and remain below 5 MiB.

### 4. File Upload & Magic Byte Hardening
- Uploaded files are validated against magic byte headers (`%PDF-1.x` for PDFs).
- Filenames are sanitized, stripped of path traversal patterns (`..`, `/`, `\`), and assigned random UUID basenames outside public web directories.
- File size is capped at 10MB per document.

### 5. Secret Encryption & Output Sanitization
- Third-party API keys (OpenAI, Anthropic, Gemini, NVIDIA) are encrypted at rest using **AES-256-GCM**.
- Model completions pass through `OutputSanitizer` to escape dangerous HTML, block `javascript:`/`data:` links, and redact PII, API keys, JWT tokens, and system paths.

### 5a. Authentication, API keys, and public conversations
- Dashboard authentication uses opaque, HttpOnly Better Auth session cookies. Every protected request loads the server-side session and current user status; no dashboard bearer token is accepted.
- Login and registration use independent Redis-backed account/IP policies; all API traffic is covered by a configurable global Redis limit. `429` responses include standard `Retry-After` and `RateLimit-*` headers.
- Organization API keys are random `acs_live_…` values shown only on issuance. The database retains a SHA-256 hash, prefix, scope metadata, expiry, revocation timestamp, and last-use timestamp. The migration hashes and clears legacy organization key values.
- A public widget key authenticates an integration, not a chat visitor. Each newly created conversation also receives a short-lived signed access token. History, feedback, and subsequent messages require that token and are tied to the exact assistant, organization, and conversation.

### 6. Persistent Audit Logging
- Privileged operations (`organization.update`, `ai.configure`, `api_key.regenerate`, `knowledge_base.delete`, `website.crawl_requested`) are logged to the `audit_logs` table with actor user IDs, IP addresses, and user agents.

### 7. Public Widget Abuse Controls
- `/public/widget.js` is cacheable static content. Widget configuration, sessions, messages, and especially LLM-backed messages are rate-limited in Redis across replicas and return `429` plus `Retry-After` when exhausted.
- Production fails closed for public rate limiting if Redis is unavailable. Provider spend limits remain an additional tenant-level control.
- Widget requests are accepted only from explicitly configured allowed origins. Configure `widgetAllowedOrigins` before embedding a widget; an empty allowlist denies browser requests.

### 8. Scale-Out Controls
- Socket.IO uses the Redis adapter so room events reach every API replica; the reverse proxy must retain WebSocket session affinity.
- PDF, text, website, and embedding work is processed by retrying BullMQ workers rather than request handlers. pgvector similarity search is backed by a cosine HNSW index while tenant filters remain mandatory.

### 9. Observability and Health
- HTTP, Express, Redis, and background work are instrumented with OpenTelemetry. Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to export traces; structured JSON logs include only correlation metadata, never message content or secrets.
- `/health/live` reports process liveness. `/health/ready` verifies PostgreSQL and Redis and returns `503` when the API must not receive traffic; `/health` remains a readiness-compatible alias.

### 10. Tenant Quotas
- `daily_token_budget` is a hard Redis-enforced budget per organization. Input estimates and maximum output tokens are reserved atomically before embedding and completion calls; exhaustion returns `429` and a reset time.
- `widget_requests_per_minute` is an independent, tenant-scoped public-widget limit. Reservations can be reconciled downward when the AI gateway exposes actual provider usage metadata.

### 11. Chat Streaming and Feedback
- Widget streaming uses an SSE response with no-cache and proxy-buffering headers. Errors and quota exhaustion are represented as stream events without exposing provider details.
- Feedback is bound to a tenant, conversation, and persisted AI message; the API validates all three before storing a rating. Operator feedback triage remains tenant-scoped.

### 12. Privacy, retention, and provider resilience
- Incoming widget messages are PII-redacted before they are persisted, embedded, logged, or sent to a provider. Detected categories are recorded only as event types, never as raw values.
- Ingestion applies the same redaction before chunks and embeddings are stored. RAG context is delimited as untrusted data and cannot supersede system instructions.
- Streaming responses are intercepted before emission; a trailing safety buffer permits cross-token secret detection and policy violations terminate the provider stream before unsafe text reaches the browser.
- `DELETE /api/v1/customers/:id` is an owner/admin right-to-be-forgotten workflow. Foreign-key cascades remove the customer, conversations, messages, tickets, and comments. Knowledge-base embeddings are organization-owned rather than customer-owned and are deliberately not deleted by this request.
- The Universal AI Gateway retries transient provider failures twice with exponential backoff. Three consecutive failures open a 30-second provider circuit; the configured fallback model is then attempted by the RAG layer without bypassing tenant quotas.

---

## Incident Reporting
To report a security vulnerability or incident, contact `security@platform.com`.
