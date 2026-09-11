# SupportAI

SupportAI is a self-hosted, multi-tenant AI customer-support platform for organizations that want AI-assisted support while keeping control over their data, infrastructure, integrations, and customer workflows.

It combines an embeddable website assistant, RAG-based knowledge retrieval, human handoff, ticketing, customer management, scheduling, integrations, analytics, a customer portal, and production-focused security controls in one platform.

## What SupportAI can do

### AI-powered customer support

- Answer customer questions with organization-specific knowledge using RAG.
- Stream responses in the website widget.
- Keep conversations tenant-scoped and tied to the correct customer context.
- Escalate conversations to human agents when AI should not continue.
- Fall back to human support when tenant AI budgets are exhausted.
- Collect helpful/not-helpful feedback on AI answers.

### Knowledge management

- Create knowledge from FAQs, text, documents, PDFs, and approved websites.
- Organize content into knowledge collections.
- Assign selected collections to individual assistants.
- Track knowledge revisions.
- Schedule automatic website recrawls.
- Skip unchanged website content to avoid unnecessary reprocessing.
- Inspect knowledge and retrieval-related information through knowledge intelligence features.

### Assistants

- Create multiple assistants per organization.
- Configure assistant behavior and AI models.
- Limit each assistant to selected knowledge collections.
- Use versioned assistant configuration.
- Give assistants access to approved tools and integrations.

### Human support and tickets

- Manage customer conversations in the support dashboard.
- Hand AI conversations over to human agents.
- Use AI-assisted reply suggestions.
- Create and manage support tickets.
- Track ticket status, priority, customer context, and attachments.
- Integrate ticket workflows with Zendesk.

### Customers and customer portal

- Maintain an organization-scoped customer directory.
- Associate customers with conversations, tickets, meetings, and support history.
- Give customers access to a dedicated portal without exposing the internal dashboard.
- Let customers review support history and ticket information.
- Expose approved customer-visible attachments.
- Show meetings and allow supported cancellation/rescheduling.
- Display linked AI memory information where enabled.

### Scheduling

- Configure meeting types and availability rules.
- Detect scheduling intent in support conversations.
- Offer valid, time-zone-aware meeting slots.
- Require approval for sensitive booking actions when configured.
- Create idempotent bookings.
- Connect Google Calendar.
- Connect Microsoft Calendar.
- Allow customers to reschedule using server-validated available slots.

### Integrations

- HubSpot CRM integration.
- Zendesk integration.
- Zendesk inbound webhook handling and signing-secret support.
- Google Calendar OAuth connection.
- Microsoft Calendar OAuth connection.
- Integration synchronization and webhook workflows.
- Tenant-scoped integration credentials stored server-side.

### Analytics and administration

- Support analytics for organization operations.
- Agent and customer management.
- Organization roles such as owner, admin, agent, and viewer.
- Platform administration separated from normal tenant administration.
- Configurable AI providers, model routing, fallback models, and usage limits.

### Attachments and object storage

- Store support attachments using S3-compatible object storage such as RustFS.
- Controlled upload and download workflows.
- Customer-portal attachment access without exposing object-storage credentials.

## Security and privacy

SupportAI is designed for deployments where customer data and infrastructure control matter.

Security controls include:

- multi-tenant isolation;
- PostgreSQL row-level security for tenant-owned data;
- authenticated sessions and role-based authorization;
- encrypted provider and integration credentials;
- runtime production-secret injection;
- file-upload validation;
- SSRF protection for outbound/public URL workflows;
- bounded request body sizes;
- rate limiting and tenant AI quotas;
- PII and secret redaction;
- prompt-injection defenses for retrieved knowledge;
- streaming-output safety controls;
- schema validation before AI tool execution;
- approval gates for sensitive tool actions;
- private PostgreSQL and Redis deployment patterns;
- repository secret protection and Gitleaks configuration.

Read [Security and privacy](docs/security.md) and [Privacy architecture](docs/privacy-architecture.md) for details.

## Who SupportAI is for

SupportAI is aimed at teams that want more control than a fully hosted support SaaS provides, including:

- companies that want to self-host customer-support infrastructure;
- organizations with data-protection or compliance requirements;
- SaaS teams that need tenant-aware AI support;
- support teams that want AI plus human escalation rather than an AI-only chatbot;
- organizations that want to connect their own CRM, ticketing, calendar, AI, and storage infrastructure.

## Documentation

The repository includes wiki-style documentation under [`docs/`](docs/index.md).

| Guide | Purpose |
| --- | --- |
| [Documentation home](docs/index.md) | Full documentation index |
| [Feature overview](docs/features.md) | Detailed explanation of product capabilities |
| [Getting started](docs/getting-started.md) | First organization, assistant, knowledge, integrations, and widget |
| [User guide](docs/user-guide.md) | Daily use for support teams and administrators |
| [Integrations](docs/integrations.md) | HubSpot, Zendesk, calendars, webhooks, and synchronization |
| [Security and privacy](docs/security.md) | Security model and operational guidance |
| [Platform administration](docs/platform-administration.md) | Deployment-wide administration |
| [Production operations](docs/production-operations.md) | Deployment, rollback, backup, restore, monitoring, and incidents |
| [Object storage](docs/object-storage.md) | RustFS/S3-compatible attachment storage |
| [Privacy architecture](docs/privacy-architecture.md) | Privacy-focused architecture notes |
| [Technology stack](docs/technologie-stack.md) | Technical architecture and technologies |

## Quick start for users

A typical organization setup looks like this:

1. Create an organization and sign in as owner.
2. Create an assistant.
3. Add FAQs, documentation, PDFs, or approved website sources.
4. Organize larger knowledge bases into collections.
5. Configure the AI provider/model.
6. Add support agents and assign roles.
7. Test AI answers and human handoff.
8. Configure tickets and optional integrations.
9. Connect calendars if meeting scheduling is required.
10. Test the customer portal.
11. Embed the website widget.
12. Review security and production settings before launch.

See [Getting started](docs/getting-started.md) for the complete guide.

## Website widget

Add the widget before the closing `</body>` tag of the customer website:

```html
<script
  src="https://api.example.com/public/widget.js"
  data-assistant-id="YOUR_ASSISTANT_ID"
  data-api-base="https://api.example.com">
</script>
```

Provider API keys, database credentials, JWTs, or organization secrets must never be placed in browser code.

## Self-hosting

SupportAI is designed to run with Docker-based infrastructure.

Core components include:

| Component | Technology |
| --- | --- |
| Dashboard | Next.js, TypeScript, Tailwind CSS |
| API | Express, TypeScript, Socket.IO |
| Database | PostgreSQL, pgvector, Drizzle ORM |
| Queue and realtime infrastructure | Redis, BullMQ |
| Object storage | S3-compatible storage such as RustFS |
| AI | Configurable external/local model providers |
| Production secrets | Runtime secret injection, e.g. Infisical |

For production deployment, backups, migrations, health checks, observability, and incident procedures, read [Production operations](docs/production-operations.md).

## Local development

Requirements:

- Node.js 22+
- Docker
- PostgreSQL with pgvector
- Redis

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
npm run dev:backend
npm run dev:frontend
```

The included seed account is for local development only and must never be used in production.

## Production principles

For a production installation:

- use HTTPS;
- inject secrets at runtime rather than committing `.env` files;
- use a non-owner PostgreSQL application role;
- keep PostgreSQL and Redis off the public internet;
- configure restrictive CORS origins;
- run at least one ingestion worker;
- configure backups and test restores;
- configure provider budgets and rate limits;
- run migrations before new API versions receive traffic;
- monitor `/health/live`, `/health/ready`, metrics, logs, and traces;
- run security and secret-scanning checks before releases.

See [Production operations](docs/production-operations.md) and [Security and privacy](docs/security.md).

## API

Public HTTP APIs are versioned under `/api/v1`.

Major product areas include authentication, organizations, assistants, assistant versions, knowledge, knowledge intelligence, collections, revisions, conversations, tickets, customers, agents, analytics, widget APIs, customer portal, scheduling, calendar OAuth, integrations, webhooks, attachments, storage, tools, and platform administration.

Breaking public API changes should use a new major API version.

## License

[MIT](LICENSE)
