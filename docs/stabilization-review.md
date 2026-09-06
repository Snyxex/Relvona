# Stabilization review — 2026-09-05

This is an ongoing review, not a production-readiness certificate.

## Baseline

- Backend TypeScript build passes.
- Frontend lint: 56 errors and 88 warnings.
- Frontend build fails fetching Google Fonts in this environment.
- Docker daemon is unavailable; database, Redis, container and real-provider integration checks are pending.
- Existing foundations: Better Auth sessions, organization membership, tenant query filters, PostgreSQL RLS setup, signed widget sessions, domain restrictions, ingestion queue, provider gateway, escalation ticket deduplication, upload validation, crawler address validation.

## Confirmed defects and priorities

1. Socket events broadcast unpersisted messages and claims. Socket authentication omits token-version revocation checks; room authorization queries protected conversations without binding the database tenant.
2. WAITING_FOR_AGENT conversations still invoke AI. Agent draft generation blocks customer message delivery and uses fabricated canned text.
3. Provider streaming catches callback failures as JSON errors and retries after output, potentially duplicating partial answers.
4. Retrieval does not exclude quarantined/incomplete sources, and fallback loses the knowledge-base restriction. Cached answers can survive source deletion.
5. Knowledge upload routes allow agents to mutate admin-owned knowledge. PDF filter accepts MIME OR extension; magic check only verifies four bytes.
6. Conversation resolution reports success for missing conversations; analytics counts human resolutions as AI resolutions and shows 100% with no conversations.
7. Knowledge retries create additional source records; queued sources are not durable until worker execution. Recrawl, FAQ editing, and job monitoring are incomplete.
8. Frontend does not consume Socket.IO; assignment, release, suggested-reply controls and full inbox filtering are incomplete.
9. Usage/cost accounting, structured classification, refreshable summaries and grouped unanswered questions are incomplete.
10. Error handling and form accessibility are inconsistent. The settings error boundary uses the older reset prop instead of the installed Next.js retry prop.

## Verification still required

Complete route/service and UI review; clean install and lint; migrations on fresh and legacy fixtures; real PostgreSQL RLS and cascade tests; Redis queue retries; API and socket authorization; PDF and website ingestion; configured provider embeddings and RAG; widget resume and handoff; browser checks for all existing pages. Preserve the existing stack and data throughout.

## Implemented in this working tree

- Backend and frontend builds pass, including TypeScript. Frontend no longer fetches Google Fonts during builds; it uses the existing system font styling.
- Frontend lint exits successfully: zero errors, 87 remaining warnings (primarily existing `any` types).
- Labels and button types repaired; installed Next.js error-boundary retry API used; settings routing-rule changes participate in dirty tracking and autosave.
- Customer messages in WAITING_FOR_AGENT and AGENT_ACTIVE persist without invoking AI. Resolved customer conversations reject new messages.
- Source retrieval joins tenant-owned, completed, SAFE sources. Unranked fallback and stale answer caching removed; low-evidence replies trigger handoff consistently. Text extracted from PDFs and websites is scanned before sources become retrievable.
- Fabricated suggested replies replaced with the existing RAG pipeline, an authenticated API and inbox controls for reviewing, editing, regenerating and discarding drafts.
- Client socket mutations no longer broadcast unpersisted messages. Persisted service events drive delivery; room joins check token revocation, support membership and tenant RLS. Delivery rechecks current token and membership. Dashboard reconnect reloads message history and deduplicates IDs.
- Knowledge writes require owner/admin, and target knowledge bases are checked before queueing. Conversation creation validates referenced customer/assistant tenancy.
- PDF filtering requires MIME plus extension; full `%PDF-` signature checked.
- Stream callback errors propagate; partial output is not retried; truncated streams fail and reader resources are released. Empty provider output becomes a durable handoff through the existing service.
- Analytics no longer counts every human resolution as an AI resolution or reports a 100% resolution rate with no conversations.
- Compiled security tests: 24 passed, zero failed. Tool registry tests and new streaming regression tests pass.

## Remaining work and limits

The full 40-section request is not complete. In particular: full repository/security review, atomic conversation transitions and concurrent AI/human takeover, assignment/release flows, durable ingestion identities/retries, PDF reprocessing, recrawling and browser fallback, FAQ editing/metadata, persisted citations, centrally configurable multi-signal confidence, comprehensive usage/cost tracking, structured classification, summary refresh, grouped unanswered questions, complete inbox filters and membership administration remain open. The change has not undergone browser or real-provider QA. Fresh dependency installation, database migrations, Docker builds and live DB/Redis/API/Socket/widget isolation tests were not completed; Docker was unavailable. Existing migration strategy still needs compatibility validation against actual fixtures.
