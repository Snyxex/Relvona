# Relvona

Relvona is a self-hosted, multi-tenant AI customer-support platform for teams that want AI-assisted support while keeping control over their data, infrastructure, integrations, and customer workflows.

It combines an embeddable AI support widget, retrieval-augmented generation (RAG), human handoff, ticketing, customer management, scheduling, integrations, analytics, a customer portal, and production-focused security controls in one platform.

> Project status: Relvona is under active development. Do not use in production, Relvona is still in testing.

## Features

### AI customer support

- Organization-specific answers using RAG.
- Streaming responses in the website widget.
- Tenant-scoped conversations and customer context.
- Human handoff when AI should not continue.
- AI-assisted reply suggestions for support agents.
- Helpful/not-helpful feedback for AI responses.
- Configurable AI providers, model routing, fallbacks, and usage limits.

### Knowledge management

- FAQs, text, documents, PDFs, and approved websites.
- Knowledge collections and assistant-specific scopes.
- Knowledge revisions and publication controls.
- Scheduled website recrawls.
- Change detection to avoid unnecessary reprocessing.
- Knowledge intelligence and retrieval tracking.

### Support operations

- Conversations and agent inbox workflows.
- Ticket creation and management.
- Customer directory and support history.
- Roles for owners, admins, agents, and viewers.
- Support analytics and operational dashboards.

### Customer portal

- Customer-visible support history and tickets.
- Approved attachments.
- Meetings and supported cancellation/rescheduling.
- Linked AI memory information where enabled.
- Portal access without exposing the internal dashboard.

### Scheduling

- Meeting types and availability rules.
- Time-zone-aware slot generation.
- Scheduling intent detection in conversations.
- Approval gates for sensitive booking actions.
- Idempotent bookings.
- Google Calendar and Microsoft Calendar connections.
- Server-validated rescheduling.

### Integrations

- HubSpot CRM.
- Zendesk ticketing and inbound webhooks.
- Google Calendar OAuth.
- Microsoft Calendar OAuth.
- Integration synchronization and webhook workflows.
- Tenant-scoped credentials stored server-side.

### Storage and attachments

- S3-compatible object storage such as RustFS.
- Controlled upload and download flows.
- Customer-portal attachment access without exposing storage credentials.

## Security and privacy

Relvona is designed for self-hosted and privacy-conscious deployments. Security controls include multi-tenant isolation, PostgreSQL row-level security, authenticated sessions, role-based authorization, encrypted provider/integration credentials, request validation, upload validation, SSRF protection, rate limiting, AI usage quotas, PII/secret redaction, RAG prompt-injection defenses, tool schema validation, approval gates for sensitive actions, and repository secret scanning.

Security documentation:

- [Security policy and architecture](SECURITY.md)
- [Security and privacy guide](docs/security.md)
- [Privacy architecture](docs/privacy-architecture.md)
- [Production operations](docs/production-operations.md)

Please do not report vulnerabilities through a public issue. Use GitHub's private vulnerability reporting / security advisory flow for this repository when available.

## Who Relvona is for

Relvona is intended for companies and teams that want more control than a fully hosted customer-support SaaS provides, especially organizations that need self-hosting, tenant-aware AI support, human escalation, custom integrations, or stronger control over customer data and infrastructure.

## Documentation

The repository includes wiki-style documentation under [`docs/`](docs/index.md).

| Guide | Purpose |
| --- | --- |
| [Documentation home](docs/index.md) | Documentation index |
| [Feature overview](docs/features.md) | Detailed product capabilities |
| [Getting started](docs/getting-started.md) | Initial organization, assistant, knowledge, integrations, and widget setup |
| [User guide](docs/user-guide.md) | Daily use for support teams and administrators |
| [Integrations](docs/integrations.md) | CRM, ticketing, calendars, webhooks, and synchronization |
| [Security and privacy](docs/security.md) | Security model and operational guidance |
| [Platform administration](docs/platform-administration.md) | Deployment-wide administration |
| [Production operations](docs/production-operations.md) | Deployment, backup, restore, monitoring, rollback, and incidents |
| [Object storage](docs/object-storage.md) | S3-compatible attachment storage |
| [Privacy architecture](docs/privacy-architecture.md) | Privacy architecture notes |
| [Technology stack](docs/technologie-stack.md) | Architecture and technologies |

## Quick start

Requirements:

- Node.js 22+
- Docker
- PostgreSQL with pgvector
- Redis

```bash
git clone https://github.com/Snyxex/Relvona.git
cd Relvona
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
docker compose up -d postgres redis
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run db:push
npm --prefix backend run db:seed
npm run dev:backend
npm run dev:frontend
```

The included development/seed configuration is for local use only. Never reuse local example passwords, tokens, or secrets in production.

For the complete setup process, read [Getting started](docs/getting-started.md).

## Website widget

A deployment can expose the Relvona widget from its API host:

```html
<script
  src="https://api.example.com/public/widget.js"
  data-assistant-id="YOUR_ASSISTANT_ID"
  data-api-base="https://api.example.com">
</script>
```

Never place provider API keys, database credentials, authentication secrets, or organization secrets in browser code.

## Architecture

| Component | Technology |
| --- | --- |
| Dashboard | Next.js, React, TypeScript, Tailwind CSS |
| API | Express, TypeScript, Socket.IO |
| Database | PostgreSQL, pgvector, Drizzle ORM |
| Queue / realtime | Redis, BullMQ |
| Object storage | S3-compatible storage such as RustFS |
| Authentication | Better Auth |
| Observability | OpenTelemetry |
| AI | Configurable external or local model providers |

## Production checklist

Before a production deployment:

- use HTTPS;
- inject secrets at runtime rather than committing `.env` files;
- generate unique high-entropy production secrets;
- use a non-owner PostgreSQL application role;
- keep PostgreSQL and Redis off the public internet;
- configure restrictive CORS and widget origins;
- configure backups and test restores;
- configure rate limits and provider budgets;
- run database migrations before routing traffic to a new API version;
- monitor health endpoints, metrics, logs, and traces;
- run tests and secret scanning before releases.

See [Production operations](docs/production-operations.md) for the full operational guide.

## API

HTTP APIs are versioned under `/api/v1`. Product areas include authentication, organizations, assistants, assistant versions, knowledge, knowledge intelligence, collections, revisions, conversations, tickets, customers, agents, analytics, widget APIs, customer portal, scheduling, calendar OAuth, integrations, webhooks, attachments, storage, tools, and platform administration.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

Relvona is licensed under the [Apache License 2.0](LICENSE).
