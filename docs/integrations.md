# SupportAI Integrations

SupportAI supports organization-scoped integrations. Integration credentials are stored server-side and administration routes require authenticated organization context and elevated permissions.

## HubSpot

HubSpot can be connected as an organization integration. Supported HubSpot tools can work with CRM data such as contacts and companies according to the permissions and tool definitions enabled by the deployment.

### Setup

1. Open the organization integration settings.
2. Create a HubSpot connection.
3. Enter the required connection configuration and credentials.
4. Save the connection.
5. Run the built-in connection test.
6. Enable only the tools that are actually needed by the assistant or support workflow.

Never place HubSpot credentials in frontend environment variables or widget code.

## Zendesk

Zendesk can be connected for ticket-related workflows, synchronization, and inbound events.

### Setup

1. Create a Zendesk integration connection.
2. Configure the required connection details and credentials.
3. Test the connection.
4. If inbound events are needed, configure a webhook signing secret.
5. Use the generated organization- and connection-specific callback path for the Zendesk webhook.

SupportAI exposes webhook setup information only for the matching Zendesk connection. Inbound events are resolved against the correct tenant and integration connection.

### Webhook security

Use a strong random signing secret and store it only in Zendesk and SupportAI. Rotate it if disclosure is suspected.

Do not accept unsigned or unverified inbound event payloads in custom extensions.

## Google Calendar

Google Calendar can be connected through the calendar OAuth flow.

The connection is used by scheduling workflows so SupportAI can work with configured availability and create supported bookings.

The OAuth flow is started by an authenticated tenant user. The callback is rate-limited and returns the user to the frontend after the connection succeeds or fails.

## Microsoft Calendar

Microsoft Calendar is supported through the same tenant-aware OAuth workflow as Google Calendar.

Use it when organization users manage availability and meetings through Microsoft services.

## Scheduling with calendars

Calendar integrations are part of the broader scheduling system. Configure:

- meeting types;
- availability rules;
- users who can be scheduled;
- connected calendar providers;
- approval requirements where appropriate.

SupportAI can then offer customer-facing time slots and create a booking after the required workflow is complete.

## Integration testing

After creating or changing an integration, always run the available connection test before relying on it in production.

A successful credential save alone does not guarantee that permissions, remote account configuration, network access, or provider-side settings are correct.

## Synchronization and inbound events

SupportAI contains dedicated synchronization and inbound integration routes. These workflows bridge external events into tenant-scoped domain events and application data.

Custom integrations should preserve the same rules:

- resolve the organization on the server;
- never trust a tenant ID supplied by an untrusted external payload without verification;
- validate payload shape;
- authenticate or verify signatures;
- use idempotency where repeated events are possible;
- avoid logging credentials or full sensitive payloads.

## Generic webhooks

SupportAI also has webhook infrastructure for event-driven workflows. Webhooks should be treated as security-sensitive external entry points.

Use HTTPS, request validation, signature verification where supported, bounded request bodies, and clear retry/idempotency behavior.

## Troubleshooting

When an integration fails:

1. run its connection test;
2. verify credentials and provider permissions;
3. verify the remote account or tenant is still active;
4. check API/worker logs using request IDs rather than logging secrets;
5. verify outbound network policy and DNS;
6. verify webhook signatures and callback configuration for inbound flows;
7. reconnect OAuth calendar providers when authorization has been revoked.

For infrastructure-related failures, also see [Production operations](production-operations.md).
