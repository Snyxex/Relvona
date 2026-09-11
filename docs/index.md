# SupportAI Documentation

Welcome to the SupportAI documentation. This documentation is written for administrators, support teams, operators, and developers.

## Start here

- [Product overview](features.md) — what SupportAI can do and how the main features work.
- [Getting started](getting-started.md) — first setup, creating an organization, configuring an assistant, and publishing the widget.
- [User guide](user-guide.md) — daily work with conversations, customers, tickets, agents, analytics, knowledge, and the customer portal.
- [Integrations](integrations.md) — HubSpot, Zendesk, Google Calendar, Microsoft Calendar, webhooks, and synchronization.
- [Security and privacy](security.md) — tenant isolation, authentication, secrets, PII protection, RLS, uploads, rate limits, and operational security.

## Administration and operations

- [Platform administration](platform-administration.md)
- [Production operations](production-operations.md)
- [Object storage](object-storage.md)
- [Privacy architecture](privacy-architecture.md)
- [Technology stack](technologie-stack.md)
- [Stabilization review](stabilization-review.md)

## Documentation map

### For support teams

Read [User guide](user-guide.md) and [Product overview](features.md).

### For organization owners and administrators

Read [Getting started](getting-started.md), [Integrations](integrations.md), and [Security and privacy](security.md).

### For self-hosted operators

Read [Production operations](production-operations.md), [Object storage](object-storage.md), and [Privacy architecture](privacy-architecture.md).

### For developers

Read [Technology stack](technologie-stack.md), the repository source, and the API routes under `backend/src/routes/`.

## Core concepts

SupportAI is multi-tenant. Each organization has its own users, assistants, knowledge, conversations, customers, tickets, integrations, settings, and analytics. Tenant-owned data is isolated at both the application layer and PostgreSQL row-level security layer.

An **assistant** is the AI support configuration presented to customers. It can use selected knowledge collections, configured AI models, tools, and integrations.

A **knowledge base** contains the information used for retrieval-augmented generation (RAG). Content can come from FAQs, text, documents, PDFs, and approved public websites.

A **conversation** is the support thread between a customer and the assistant or a human support agent. Conversations can be escalated, handed over, or turned into tickets.

A **customer portal** lets customers review support activity, tickets, approved attachments, meetings, and linked memory information without giving them access to the internal dashboard.
