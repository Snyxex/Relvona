# Getting Started with Relvona

This guide is for organization owners and administrators who want to set up Relvona for real customer support.

## 1. Sign in and create your organization

After the platform has been deployed, create your account and organization. The organization is the security and data boundary for your assistants, customers, conversations, knowledge, tickets, integrations, and analytics.

Use an owner account for the initial setup. Invite additional staff later and assign only the permissions they need.

## 2. Create your first assistant

Create an assistant for the website, product, or department that should receive customer questions.

Configure the assistant name and behavior, then select the AI model and knowledge collections it is allowed to use. Keep assistants narrowly scoped when different teams or products should not share the same knowledge.

## 3. Add knowledge

Open the knowledge area and add the information your assistant should use.

Typical sources include:

- FAQs
- support documentation
- product manuals
- PDF files
- approved public documentation websites
- internal support text that is safe for customer-facing answers

Organize larger knowledge bases into collections and assign only the relevant collections to each assistant.

After ingestion, test several realistic customer questions. Verify not only whether the answer sounds correct, but also whether the retrieved information comes from the expected source.

## 4. Configure an AI provider

Configure an AI provider/model in the administration area. A deployment can use platform-level provider credentials or organization-specific credentials depending on how the installation is operated.

Provider credentials are sensitive. Never place them in browser code, documentation screenshots, source control, or public issue reports.

Before going live, configure sensible model limits and tenant token budgets.

## 5. Configure human support

Add support staff and choose the appropriate roles.

- **Owner** — full organization control.
- **Admin** — administration and operational configuration.
- **Agent** — day-to-day support work.
- **Viewer** — read-oriented access with restricted actions.

Test the human handoff flow so that a customer can be moved from AI support to an agent when needed.

## 6. Configure tickets

Use tickets for requests that require follow-up instead of an immediate chat response. Test creating, updating, and resolving tickets before customers use the platform.

If Zendesk is used by the organization, connect it under integrations and verify the integration test before enabling synchronization or inbound webhooks.

## 7. Optional: connect calendars

If the assistant should schedule meetings, configure meeting types and availability rules. Connect Google Calendar or Microsoft Calendar through the supported OAuth flow.

Test the complete flow:

1. customer asks for a meeting;
2. assistant offers valid slots;
3. customer chooses a slot;
4. any required approval is completed;
5. booking is created;
6. customer can see or reschedule the meeting in the customer portal.

## 8. Optional: connect HubSpot or Zendesk

HubSpot and Zendesk connections are configured per organization. Credentials are stored server-side and are not exposed to the browser.

After creating a connection, use the built-in connection test. For Zendesk inbound synchronization, also configure the webhook signing secret and callback as documented in [Integrations](integrations.md).

## 9. Test the customer portal

Verify that a customer can access the portal and see only their own supported data.

Test at least:

- support history
- ticket information
- approved attachments
- meetings
- meeting cancellation/rescheduling
- linked memory information, if enabled

## 10. Install the website widget

Embed the widget on the customer website using the assistant ID and the public API origin.

Example:

```html
<script
  src="https://api.example.com/public/widget.js"
  data-assistant-id="YOUR_ASSISTANT_ID"
  data-api-base="https://api.example.com">
</script>
```

Do not put provider API keys, database credentials, organization secrets, JWTs, or internal API tokens in the page.

If the customer website uses Content-Security-Policy, allow the Relvona API origin for the widget script, API calls, and WebSocket connections.

## 11. Review security before launch

Before sending real customer traffic to the platform:

- use HTTPS everywhere;
- use unique production secrets;
- keep PostgreSQL and Redis private;
- restrict CORS to the required dashboard origins;
- verify backups and restore procedures;
- configure provider spend limits and tenant budgets;
- verify object storage access;
- review organization roles;
- test rate limits and handoff behavior;
- review audit and application logs without logging message secrets or credentials.

Read [Security and privacy](security.md) and [Production operations](production-operations.md) before production use.

## Recommended launch test

Create a test customer and run the same workflow a real customer would use:

1. ask an answerable knowledge question;
2. ask an unknown question and verify safe escalation;
3. create a support ticket;
4. send the conversation to an agent;
5. schedule a meeting if scheduling is enabled;
6. open the customer portal;
7. verify that a second organization cannot access any of the first organization's data.

Once this works end to end, the installation is ready for a controlled production rollout.
