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
| Infrastructure | Redis, Docker Compose | Cache/queue infrastructure and deployment |

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

1. Create a root `.env` file. It is ignored by Git.

```dotenv
POSTGRES_PASSWORD=use-a-long-random-database-password
JWT_SECRET=generate-a-long-random-value
ENCRYPTION_SECRET=generate-a-different-long-random-value
CORS_ORIGIN=https://app.example.com
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
OPENAI_API_KEY=optional-platform-default-key
```

Generate secrets with `openssl rand -base64 48`. Put HTTPS reverse proxies in front of the dashboard and API; do not expose PostgreSQL or Redis publicly.

2. Build and start the application:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The `migrate` service applies Drizzle migrations before the API starts. Check it with `docker compose -f docker-compose.prod.yml logs migrate`.

3. Register the first organization in the dashboard. Do not run the demo seed in production.

## Configure the application

[`backend/.env.example`](backend/.env.example) documents backend variables. The required production values are:

- `DATABASE_URL`: PostgreSQL connection string with pgvector enabled
- `JWT_SECRET`: signs sessions; mandatory in production
- `ENCRYPTION_SECRET`: encrypts provider keys at rest; mandatory in production
- `CORS_ORIGIN`: comma-separated dashboard origins, never `*`
- Provider keys: optional platform defaults; tenants can add their own under Admin → API Keys

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

## Release checklist

- Use HTTPS and set unique `JWT_SECRET`, `ENCRYPTION_SECRET`, and `POSTGRES_PASSWORD` values.
- Limit `CORS_ORIGIN` to dashboard domains.
- Back up PostgreSQL and test restore procedures.
- Configure provider-spend limits and review audit logs.
- Rotate keys after any suspected exposure.
- Run migrations in the release pipeline before deploying a new API version.

## Development commands

```bash
npm run build:backend
npm run build:frontend
npm --prefix backend run test:security
npm --prefix backend run db:generate
npm --prefix backend run db:push
```

## License

[MIT](LICENSE)
