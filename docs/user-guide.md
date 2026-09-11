# SupportAI User Guide

This guide explains how organization users work with SupportAI day to day.

## Dashboard

The dashboard is the main workspace for support operations. Depending on your role, it provides access to conversations, customers, tickets, agents, analytics, knowledge, assistants, integrations, and organization settings.

## Conversations

The conversations area contains customer support threads handled by AI or human agents.

Use it to:

- review customer messages and AI responses;
- identify conversations waiting for a human;
- take over a conversation as an agent;
- review relevant customer and ticket context;
- use AI-assisted reply suggestions where available;
- continue a conversation without exposing internal administration data to the customer.

SupportAI can automatically escalate when a request requires human intervention or when configured AI usage limits prevent another model call.

## Customers

The customer directory groups known customer information inside the current organization.

A customer can be associated with conversations, tickets, support history, portal data, meetings, and linked memory information. Tenant isolation means customer records from another organization are not part of your directory.

## Tickets

Tickets are used for support work that requires tracking beyond an immediate chat response.

Typical ticket actions include:

- reviewing subject, status, and priority;
- following up on unresolved customer requests;
- associating support context with the customer;
- working with approved attachments;
- synchronizing supported workflows with Zendesk when configured.

## Agents

The agents area helps organization administrators manage support users and operational access.

Roles determine what a user is permitted to do. Give users the least privilege needed for their work, especially for integration setup, organization settings, and sensitive actions.

## Analytics

Analytics helps teams understand support activity and identify where the support experience can improve.

Use analytics together with conversation outcomes, ticket activity, agent work, AI answer feedback, and knowledge usage. Analytics is tenant-scoped and is intended for operational decisions within the organization.

## Knowledge

Knowledge is the source material used by the AI assistant for RAG-based answers.

### Adding knowledge

Add supported content such as FAQs, documents, PDFs, text, and approved public websites.

### Collections

Use collections to group related information. For example:

- Product A
- Product B
- Billing
- Technical support
- English documentation
- German documentation

Then assign the relevant collections to each assistant.

### Revisions and recrawling

SupportAI can retain revision information and can recrawl website sources. Automatic recrawling is useful for documentation sites that change regularly. Unchanged content can be skipped to avoid unnecessary processing.

## Assistants

Assistants represent customer-facing AI support configurations.

An assistant combines:

- configured behavior;
- model/provider settings;
- selected knowledge scope;
- available tools and integrations;
- versioned configuration.

Use separate assistants when different websites, products, or departments require different behavior or knowledge.

## Integrations

Organization owners and administrators can configure supported external systems. Current integration areas include HubSpot, Zendesk, Google Calendar, Microsoft Calendar, and webhooks/synchronization flows.

See [Integrations](integrations.md).

## Meetings and scheduling

When scheduling is enabled, SupportAI can help customers book meetings from a chat conversation.

The assistant can offer available slots according to configured meeting types and availability. Sensitive booking actions can require approval before execution.

Customers can also manage supported meeting actions from the customer portal, including cancellation and rescheduling to server-validated available slots.

## Customer portal

The customer portal is designed for end customers, not staff.

It can show supported customer-facing information such as:

- previous support conversations;
- tickets;
- customer-visible ticket attachments;
- upcoming meetings;
- meeting rescheduling and cancellation;
- linked AI memory information where enabled.

Customers do not receive access to the internal organization dashboard through the portal.

## Attachments

Attachments can be stored using the configured object storage backend. Customer-facing downloads are controlled by the application rather than exposing storage credentials directly.

Only share attachments with customers when they are intended to be customer-visible.

## AI answer feedback

Where enabled, customers can rate AI answers as helpful or not helpful. Operators can use this feedback to find weak knowledge, poor retrieval results, or assistant behavior that needs improvement.

## Recommended daily workflow for support agents

1. Check conversations waiting for an agent.
2. Review unresolved and high-priority tickets.
3. Respond to customers that require human help.
4. Review low-quality AI feedback and identify missing knowledge.
5. Escalate knowledge issues to an administrator instead of working around them with unsafe prompts.
6. Confirm that customer data remains within the correct organization context.

## Recommended weekly workflow for administrators

1. Review analytics and answer feedback.
2. Check failed or stale knowledge sources.
3. Review organization members and roles.
4. Test critical integrations.
5. Review AI usage and token budgets.
6. Check unresolved tickets and handoff patterns.
7. Review security and operational logs for anomalies without exposing customer message content or secrets unnecessarily.
