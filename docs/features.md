# SupportAI Feature Overview

This page describes SupportAI from a product and user perspective.

## AI customer support

SupportAI provides AI-assisted customer support for websites and customer-facing applications. The assistant can answer questions using organization-specific knowledge, continue existing conversations, escalate requests, and hand work to human agents.

The platform uses retrieval-augmented generation (RAG), which means the model can search approved organization knowledge before producing an answer instead of relying only on general model knowledge.

## Knowledge management

Organizations can build a knowledge base from multiple source types:

- FAQs
- plain text and documents
- PDF files
- approved public websites
- structured knowledge collections

Knowledge can be organized into collections and assigned to specific assistants. This allows one organization to maintain separate knowledge for products, departments, languages, or customer groups.

SupportAI also tracks knowledge revisions so administrators can understand how content changed over time. Website sources can be scheduled for automatic recrawling, and unchanged pages can be skipped instead of rebuilding embeddings unnecessarily.

Knowledge intelligence features help administrators understand retrieval behavior and the use of stored knowledge.

## Assistants

Organizations can create and configure multiple assistants. Each assistant can have its own:

- name and customer-facing behavior
- AI model configuration
- knowledge scope
- tool access
- organization context
- version history

Assistant versions make configuration changes easier to track and review.

## AI providers and model routing

SupportAI supports configurable AI providers and model selection. Provider credentials are stored encrypted and can be configured as platform defaults or per organization.

The platform includes model routing, fallback behavior, request timeouts, bounded retries, circuit breaking, and tenant token budgets so provider failures or excessive usage do not silently consume unlimited resources.

## Website support widget

The embeddable widget allows customers to start support conversations directly on a website.

The widget supports:

- AI answers based on organization knowledge
- streaming answers
- conversation continuity
- feedback on AI answers
- escalation to human support
- request throttling
- signed widget conversation capabilities
- privacy-related controls

The widget does not require provider API keys in browser code.

## Conversations and human handoff

Support staff can work with customer conversations in the dashboard. AI conversations can be transferred to human agents when the assistant cannot safely or confidently complete the request.

The platform can move conversations into waiting-for-agent states when required, including when an AI token budget is exhausted.

Support agents can review conversation context and use AI-assisted reply suggestions while retaining control over customer communication.

## Tickets

SupportAI includes an internal ticket workflow. Tickets can be created from support activity or escalation flows and can carry status, priority, customer context, and related attachments.

Ticket data can also interact with external systems such as Zendesk when an integration is configured.

## Customers

The customer directory provides a tenant-scoped view of known customers and their related support activity. Customers can be associated with conversations, tickets, memories, and portal access.

## Customer portal

The customer portal gives end users a dedicated view of their support data without exposing the internal administration dashboard.

Customers can access supported portal capabilities such as:

- support history
- ticket information
- approved ticket attachments
- scheduled meetings
- meeting cancellation
- rescheduling through validated available time slots
- linked AI memory information where applicable

Portal access is separated from internal staff authentication.

## Scheduling and meetings

SupportAI includes a scheduling workflow for support and sales-like conversations.

The assistant can detect scheduling intent, offer available time slots, wait for required approval, and create bookings through configured calendar providers.

The scheduling system includes:

- meeting types
- availability rules
- time-zone-aware slots
- approval-aware booking actions
- idempotent booking execution
- Google Calendar connectivity
- Microsoft Calendar connectivity
- customer portal rescheduling

## HubSpot integration

Organizations can connect HubSpot and expose approved CRM operations through SupportAI tools. Integration credentials are tenant-scoped and encrypted.

Depending on configured permissions and tools, SupportAI can work with CRM data such as contacts or companies while applying role and tool-input validation.

## Zendesk integration

Organizations can connect Zendesk for ticket-related workflows. SupportAI includes connection testing, synchronization capabilities, inbound webhook handling, and webhook signing-secret configuration.

Inbound events are associated with the correct organization and integration connection.

## Webhooks and integration synchronization

The platform includes a webhook and domain-event architecture for synchronizing internal support events with integration workflows.

Integration synchronization runs through explicit tenant context rather than unrestricted cross-tenant access.

## Attachments and object storage

SupportAI supports attachments and object storage for support workflows. Object storage can use an S3-compatible service such as RustFS.

The storage lifecycle includes controlled upload/download behavior and customer-portal attachment access. See [Object storage](object-storage.md) for infrastructure details.

## Analytics

The analytics area helps organizations understand support activity and usage. It provides operational views for customer support rather than exposing raw cross-tenant data.

Analytics can be used alongside answer feedback, conversations, tickets, agent activity, and knowledge-related information to identify areas that need improvement.

## Organizations, members, and roles

SupportAI is designed for multiple organizations. Each organization owns its own data and configuration.

The platform uses role-based access controls such as:

- owner
- admin
- agent
- viewer

Sensitive administration routes and integration configuration require elevated roles.

## Platform administration

Separate platform administration capabilities exist for operators who manage the SupportAI deployment itself. Platform administration is distinct from normal organization administration.

See [Platform administration](platform-administration.md).

## Security controls

Important security features include:

- tenant isolation
- forced PostgreSQL row-level security for tenant data
- authenticated administration routes
- role-based authorization
- encrypted provider and integration credentials
- request and widget rate limiting
- file upload validation
- SSRF protection for URL-based ingestion and outbound integrations
- prompt-injection defenses for retrieved knowledge
- PII and secret redaction
- safe streaming-output filtering
- AI tool schema validation before execution
- approval gates for sensitive tool actions
- audit-oriented administration flows
- bounded request body sizes
- private database and Redis deployment design
- runtime secret injection for production

See [Security and privacy](security.md) for details.

## Self-hosting and production operations

SupportAI is designed to be self-hosted with Docker-based infrastructure. PostgreSQL, pgvector, Redis, workers, the API, and the frontend can be deployed as separate services while keeping data services on private networks.

Production deployments can load application secrets at runtime from Infisical instead of storing them in images or source control.

See [Production operations](production-operations.md).
