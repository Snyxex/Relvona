# Contributing to Relvona

Thanks for contributing to Relvona.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Keep changes focused and explain the user-facing or technical reason for them.
- Do not include production credentials, customer data, private URLs, private infrastructure details, or other secrets in commits, issues, logs, screenshots, fixtures, or pull requests.
- Security vulnerabilities must follow [`SECURITY.md`](SECURITY.md) and must not be reported through a public issue.

## Development setup

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
npm run dev:backend
npm run dev:frontend
```

Use local development secrets only. Never reuse example or CI values in production.

## Pull requests

A pull request should:

- explain what changed and why;
- include tests for security-sensitive, tenant-sensitive, authorization, persistence, or integration behavior where practical;
- keep tenant boundaries intact;
- avoid weakening validation, rate limits, approval gates, SSRF protection, upload validation, or secret handling;
- update documentation for user-visible behavior;
- pass backend and frontend builds and the relevant tests.

## Security-sensitive changes

Changes involving authentication, authorization, tenant isolation, AI tools, RAG retrieval, file uploads, web crawling, integrations, encryption, secrets, customer deletion, or platform administration require additional review.

When adding a new external integration, keep credentials server-side, encrypt sensitive configuration where appropriate, validate inbound signatures/webhooks where supported, and apply organization scoping to every operation.

## Code style

Follow the existing TypeScript structure and conventions in the repository. Prefer explicit validation and deterministic server-side authorization over client-side or model-enforced security assumptions.

## Documentation

User-facing features should be documented under `docs/`. Keep the root README concise and link to the detailed guide.

## License

By contributing to Relvona, you agree that your contributions are provided under the repository's [Apache License 2.0](LICENSE).
