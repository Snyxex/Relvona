# Security Policy & Architecture

## Security Architecture Overview

The AI Customer Support Platform is built on a **Zero-Trust AI Architecture**. The Large Language Model (LLM) is treated as an untrusted third-party component. Authentication, authorization, tenant isolation, and administrative permission checks are strictly enforced by deterministic server-side code in Node.js/Express and PostgreSQL.

```
User Input ──► Rate Limiting & Validation ──► Authentication (JWT/Key) ──► Tenant-Scoped Vector Search ──► Tag-Delimited Prompt ──► LLM Gateway ──► Output Sanitization ──► Client
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
- URLs are pre-parsed and DNS is pre-resolved before making HTTP connections.
- Private IPv4/v6 ranges (`127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), cloud metadata endpoints (`169.254.169.254`), and non-HTTP/HTTPS protocols (`file://`, `gopher://`, `data://`) are blocked.
- HTTP redirects are manually inspected and re-validated against IP filters.

### 4. File Upload & Magic Byte Hardening
- Uploaded files are validated against magic byte headers (`%PDF-1.x` for PDFs).
- Filenames are sanitized, stripped of path traversal patterns (`..`, `/`, `\`), and assigned random UUID basenames outside public web directories.
- File size is capped at 10MB per document.

### 5. Secret Encryption & Output Sanitization
- Third-party API keys (OpenAI, Anthropic, Gemini, NVIDIA) are encrypted at rest using **AES-256-GCM**.
- Model completions pass through `OutputSanitizer` to escape dangerous HTML, block `javascript:`/`data:` links, and redact PII, API keys, JWT tokens, and system paths.

### 6. Persistent Audit Logging
- Privileged operations (`organization.update`, `ai.configure`, `api_key.regenerate`, `knowledge_base.delete`, `website.crawl_requested`) are logged to the `audit_logs` table with actor user IDs, IP addresses, and user agents.

---

## Incident Reporting
To report a security vulnerability or incident, contact `security@platform.com`.
