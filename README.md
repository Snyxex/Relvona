# SupportAI

SupportAI is a multi-tenant AI customer-support platform. Organizations can create branded assistants, train them on FAQs, documents, PDFs, and public URLs, then embed a support widget on any website. Unresolved requests can be handed to a human agent or converted into tickets.

It is built for SaaS teams that need tenant isolation, configurable AI models, auditable administration, and a practical support workflow.

## Features

- RAG-based answers using PostgreSQL and pgvector
- Tenant isolation, JWT authentication, and owner/admin/agent/viewer roles
- Embeddable support widget, human handoff, and ticket workflow
- PDF, text, FAQ, and website ingestion with SSRF and file-security controls
- Admin model routing, fallback models, token limits, audit logs, and encrypted provider keys
- Analytics, customer conversations, and agent-suggested replies

## Architecture

| Component | Technology | Purpose |
| --- | --- | --- |
| Dashboard | Next.js 16, TypeScript, Tailwind | Tenant administration and support operations |
| API | Express, Socket.IO, TypeScript | Authentication, RAG, widgets, tickets, admin APIs |
| Data | PostgreSQL + pgvector, Drizzle | Tenant data and semantic search |
| Infrastructure | Redis, BullMQ, Docker Compose | Distributed rate limits, Socket.IO pub/sub, ingestion jobs, and deployment |

## Local installation

Requirements: Node.js 22+, Docker Desktop, and an OpenAI API key or a tenant provider key configured later in the dashboard.

```bash
git clone <repository-url>
cd AI_Customer_Sup
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
docker compose up -d postgres redis
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run db:push
npm --prefix backend run db:seed
```

Start the API and dashboard in two terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Open `http://localhost:3000`. The seed account is for local development only:

- Email: `alex@acme.com`
- Password: `Password123!`

Never use demo credentials in a public environment.

## Deploy with Docker

1. Create a root `.env` file for local development. It is ignored by Git. Application secrets in production are supplied by Infisical at container startup, never committed to Compose or an image.

```dotenv
POSTGRES_PASSWORD=use-a-long-random-database-password
JWT_SECRET_CURRENT=generate-a-long-random-value
ENCRYPTION_SECRET_CURRENT=generate-a-different-long-random-value
ENCRYPTION_KEY_ID=v1
CORS_ORIGIN=https://app.example.com
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
OPENAI_API_KEY=optional-platform-default-key
```

Generate local-only secrets with `openssl rand -base64 48`. Put an HTTPS reverse proxy in front of the dashboard and API; do not expose PostgreSQL or Redis publicly.

2. In Infisical, create separate `backend` and `migrate` Machine Identities with read-only project access, place production variables in the production environment, and authenticate the deployer via Universal Auth. Set only `INFISICAL_TOKEN`, `INFISICAL_PROJECT_ID`, optional `INFISICAL_DOMAIN`, and `INFISICAL_ENVIRONMENT` in the deployment environment. Put the application database URL, Redis URL, JWT, encryption, CORS, and provider values in Infisical; `POSTGRES_PASSWORD` is only the PostgreSQL image bootstrap credential and must come from the deployment platform's secret store. The one-shot `migrate` identity additionally needs `DATABASE_ADMIN_URL`, `DATABASE_APP_USER`, and `DATABASE_APP_PASSWORD`; the API/worker identity receives only `DATABASE_URL` for that non-owner application user.

3. Build and start the application:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The `migrate` service applies Drizzle migrations before the API starts. Production images start through a pinned Infisical CLI and fetch secrets at runtime. Check it with `docker compose -f docker-compose.prod.yml logs migrate`.

4. Register the first organization in the dashboard. Do not run the demo seed in production.

## Configure the application

[`backend/.env.example`](backend/.env.example) documents backend variables. The required production values are:

- `DATABASE_URL`: PostgreSQL connection string with pgvector enabled
- `JWT_SECRET_CURRENT`: signs new sessions; mandatory in production
- `ENCRYPTION_SECRET_CURRENT`: encrypts provider keys at rest; mandatory in production
- `CORS_ORIGIN`: comma-separated dashboard origins, never `*`
- Provider keys: optional platform defaults; tenants can add their own under Admin → API Keys
- `INGESTION_WORKER_CONCURRENCY`: worker concurrency, default `2`; scale `worker` replicas for document, PDF, crawl, and embedding jobs.
- `daily_token_budget`: hard per-tenant daily token budget, default `100000`; configure it through `PUT /api/v1/admin/settings/quotas` together with `widget_requests_per_minute`.
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`: optional OTLP/HTTP endpoint for distributed traces; `OTEL_SERVICE_NAME` defaults to `ai-customer-support`.
- `DATABASE_URL`: in production, a `supportai_app` non-owner login. `db:migrate` provisions it from `DATABASE_APP_USER`/`DATABASE_APP_PASSWORD`, enables forced RLS policies, and uses `DATABASE_ADMIN_URL` only in the migration container. Do not give `DATABASE_ADMIN_URL` to API or worker containers.

[`frontend/.env.example`](frontend/.env.example) contains `NEXT_PUBLIC_API_URL`, the browser-reachable API URL including `/api/v1`.

## First-use workflow

1. Register an organization and sign in as owner.
2. Create a knowledge base and add FAQ text, documents, PDFs, or an approved public URL.
3. Configure an AI provider/model under the assistant or Admin → AI Models.
4. Add a tenant provider key if no platform default is configured.
5. Test answers, source quality, ticket escalation, and agent handoff.
6. Embed the widget on your website.

## Widget installation

Add this immediately before the closing `</body>` tag:

```html
<script
  src="https://api.example.com/public/widget.js"
  data-assistant-id="YOUR_ASSISTANT_ID"
  data-api-base="https://api.example.com">
</script>
```

Do not place provider API keys, JWTs, or organization API keys in browser code.

### Content-Security-Policy (CSP)

Tenant sites should allow the API origin only for the widget script and API calls. Add the following directives to the site's existing CSP, replacing `https://api.example.com` with the deployment origin:

```text
script-src 'self' https://api.example.com;
connect-src 'self' https://api.example.com wss://api.example.com;
img-src 'self' https://api.example.com data:;
style-src 'self' 'unsafe-inline';
```

The widget does not require tenant-supplied HTML or JavaScript. Treat any future tenant CSS/HTML customization as untrusted: permit colors, logos, and fixed style tokens only; never inject arbitrary markup, style URLs, or script URLs.

## Release checklist

- Use HTTPS and set unique `JWT_SECRET_CURRENT`, `ENCRYPTION_SECRET_CURRENT`, and `POSTGRES_PASSWORD` values.
- Limit `CORS_ORIGIN` to dashboard domains.
- Back up PostgreSQL and test restore procedures.
- Configure provider-spend limits and review audit logs.
- Rotate keys after any suspected exposure: introduce `*_PREVIOUS` and a new `*_CURRENT`/`ENCRYPTION_KEY_ID` in Infisical, deploy the dual-key release, run `npm run secrets:rotate` once through Infisical, then remove the previous values after the seven-day JWT overlap. Back up PostgreSQL before re-encryption.
- Compose uses an `edge` network for a reverse proxy, frontend, and API plus an internal `data` network for Postgres and Redis. Only the reverse proxy may publish host ports; join it to the external `supportai-edge` network.
- Socket.IO uses Redis Pub/Sub through the Redis adapter, so events propagate across API replicas. Configure sticky sessions at the reverse proxy for WebSocket connection affinity.
- Ingestion endpoints return `202` and enqueue BullMQ jobs; run at least one `worker` service. Completed/failed job retention and retry backoff are configured in the queue.
- `document_chunks` has a cosine-distance HNSW pgvector index, created idempotently by `db:migrate`; the existing tenant/knowledge-base B-tree index remains for tenant filtering.
- Health probes: `GET /health/live` is a dependency-free liveness probe; `GET /health/ready` (and the backward-compatible `/health`) verifies PostgreSQL and Redis and returns `503` until ready. Docker uses readiness for its healthcheck.
- API and worker emit JSON logs with request/job, tenant, conversation, and OpenTelemetry trace IDs. Never add message bodies, credentials, tokens, or provider payloads to log fields.
- Tenant quotas are enforced in Redis before embedding and completion calls. Reservations estimate input characters/4 plus configured maximum output; the public widget has an independent per-tenant request-per-minute limit. Exhaustion returns `429` and `Retry-After`.
- Incoming support messages are redacted for payment-card numbers, password assignments, email addresses, phone numbers, API keys, and JWTs before persistence, embeddings, logs, or provider calls. Do not use the chat widget to collect sensitive credentials.
- RAG source blocks are explicitly marked as untrusted reference data. They cannot override the system-instruction hierarchy; instruction-like source content is neutralized before prompt construction. Vector retrieval receives only the server-derived organization ID and is guarded again by PostgreSQL RLS.
- Streaming output keeps a 128-character safety buffer, redacts secrets/PII before each emitted segment, and aborts on system-prompt/instruction leakage indicators. No raw prompts, responses, credentials, or PII may be added to logs or telemetry.
- Public-widget throttling is enforced both per tenant and per end user (the customer bound to the conversation) to prevent knowledge-base enumeration.
- A daily token-budget exhaustion never invokes the provider: the conversation is moved to `WAITING_FOR_AGENT`, a `budget-fallback` ticket is created, and the visitor receives a fixed handoff message. The independent request-per-minute limit continues to return `429` with `Retry-After`.
- Provider calls use bounded exponential retries for transient failures and a per-provider circuit breaker (three failures, 30-second cooldown). `fallback_model` is tried only after the primary completion path is exhausted.
- PostgreSQL RLS is forced for tenant-owned tables. Every application query runs with a transaction-local `app.organization_id`; a missing tenant context sees no tenant rows. The widget uses narrowly scoped security-definer functions for its public assistant configuration only.
- Widget chat supports SSE at `POST /api/v1/widget/message/stream`; it emits `status`, `token`, `complete`, and `error` events while retaining the buffered `/message` endpoint for compatible clients. AI answers include tenant-scoped helpful/not-helpful controls; operators can triage feedback at `GET /api/v1/admin/settings/answer-feedback`.
- Run migrations in the release pipeline before deploying a new API version.

## CI/CD and releases

GitHub Actions runs on every pull request and change to `main`:

- installs locked backend and frontend dependencies, builds both applications, and runs `test:security` from compiled output;
- runs `npm audit` against production dependencies and blocks critical findings;
- runs CodeQL SAST for JavaScript/TypeScript.

The CI integration suite starts an ephemeral pgvector PostgreSQL instance, provisions the non-owner RLS application role, and verifies that Tenant A cannot read Tenant B data even when it queries a known primary key.

`test:security` is a functional security regression suite, not a SAST or dependency scanner. It checks SSRF/private-network blocking, upload validation and prompt-poisoning detection, output sanitization/redaction, and escalation heuristics.

Promotion to production is a separate, approved deployment step: authenticate the deployment environment with Infisical, run `docker compose -f docker-compose.prod.yml up -d --build`, let `migrate` complete, then require `/health/ready` to return `200` before directing traffic to the new API. Do not run migrations from pull-request CI and do not provide production secrets to it.

## API versioning and deprecation

All public HTTP endpoints are versioned under `/api/v1`. Additive changes are permitted within a major version; changing or removing a field, validation rule, or endpoint requires a new major version such as `/api/v2`.

Deprecated endpoints remain available for at least 90 days after announcement. During that period responses include `Deprecation: true`, a `Sunset` date, and a `Link` header pointing to the replacement documentation. Breaking changes require a migration guide and release-note entry before deployment.

## Development commands

```bash
npm run build:backend
npm run build:frontend
npm --prefix backend run test:security
npm --prefix backend run test:tenant-isolation
npm --prefix backend audit --omit=dev --audit-level=critical
npm --prefix backend run db:generate
npm --prefix backend run db:push
```

## License

[MIT](LICENSE)
