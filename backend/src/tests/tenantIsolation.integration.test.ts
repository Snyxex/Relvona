import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL are required for the tenant-isolation integration test");

const organizationA = randomUUID();
const organizationB = randomUUID();
const customerA = randomUUID();
const customerB = randomUUID();
const meetingTypeA = randomUUID();
const meetingTypeB = randomUUID();
const actionA = randomUUID();
const actionB = randomUUID();
const integrationA = randomUUID();
const integrationB = randomUUID();
const inboundA = randomUUID();
const inboundB = randomUUID();
const ticketA = randomUUID();
const ticketB = randomUUID();
const externalActorA = randomUUID();
const externalActorB = randomUUID();
const externalMessageA = randomUUID();
const externalMessageB = randomUUID();
const admin = new pg.Client({ connectionString: adminUrl });
const app = new pg.Client({ connectionString: appUrl });

async function asTenant(organizationId: string, work: () => Promise<void>) {
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    await work();
    await app.query("COMMIT");
  } catch (error) {
    await app.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  await admin.connect();
  await app.connect();
  try {
    await admin.query("INSERT INTO organizations (id, name, slug, api_key) VALUES ($1, 'RLS Tenant A', $2, $3), ($4, 'RLS Tenant B', $5, $6)", [organizationA, `rls-a-${organizationA}`, `key-a-${organizationA}`, organizationB, `rls-b-${organizationB}`, `key-b-${organizationB}`]);

    await asTenant(organizationA, async () => {
      await app.query("INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'a@example.test', 'A')", [customerA, organizationA]);
      await app.query("INSERT INTO meeting_types (id, organization_id, name, slug, duration_minutes) VALUES ($1, $2, 'Tenant A Meeting', $3, 30)", [meetingTypeA, organizationA, `tenant-a-${meetingTypeA}`]);
      await app.query("INSERT INTO action_executions (id, organization_id, tool_id, risk_level) VALUES ($1, $2, 'scheduling.create_booking', 'write')", [actionA, organizationA]);
      await app.query("INSERT INTO integration_connections (id, organization_id, provider, name, encrypted_credentials) VALUES ($1, $2, 'zendesk', 'Tenant A Zendesk', 'rls-test-encrypted-a')", [integrationA, organizationA]);
      await app.query("INSERT INTO integration_inbound_events (id, organization_id, connection_id, provider, invocation_id, event_type, payload) VALUES ($1, $2, $3, 'zendesk', 'inv-tenant-a', 'ticket.updated', '{}'::jsonb)", [inboundA, organizationA, integrationA]);
      await app.query("INSERT INTO tickets (id, organization_id, customer_id, ticket_number, subject, priority, status, tags) VALUES ($1, $2, $3, 9101, 'Tenant A ticket', 'normal', 'open', '[]'::jsonb)", [ticketA, organizationA, customerA]);
      await app.query("INSERT INTO external_actors (id, organization_id, connection_id, provider, external_id, role, display_name) VALUES ($1, $2, $3, 'zendesk', 'external-a', 'end-user', 'External A')", [externalActorA, organizationA, integrationA]);
      await app.query("INSERT INTO external_ticket_messages (id, organization_id, ticket_id, connection_id, actor_id, provider, external_message_id, content) VALUES ($1, $2, $3, $4, $5, 'zendesk', 'message-a', 'Tenant A external message')", [externalMessageA, organizationA, ticketA, integrationA, externalActorA]);

      const ownCustomer = await app.query("SELECT id FROM customers WHERE id = $1", [customerA]);
      assert.equal(ownCustomer.rowCount, 1, "Tenant A must read its own customer");
      const ownMeeting = await app.query("SELECT id FROM meeting_types WHERE id = $1", [meetingTypeA]);
      assert.equal(ownMeeting.rowCount, 1, "Tenant A must read its own meeting type");
      const ownAction = await app.query("SELECT id FROM action_executions WHERE id = $1", [actionA]);
      assert.equal(ownAction.rowCount, 1, "Tenant A must read its own action execution");
      const ownInbound = await app.query("SELECT id FROM integration_inbound_events WHERE id = $1", [inboundA]);
      assert.equal(ownInbound.rowCount, 1, "Tenant A must read its own inbound integration event");
      const ownActor = await app.query("SELECT id FROM external_actors WHERE id = $1", [externalActorA]);
      assert.equal(ownActor.rowCount, 1, "Tenant A must read its own external actor");
      const ownMessage = await app.query("SELECT id FROM external_ticket_messages WHERE id = $1", [externalMessageA]);
      assert.equal(ownMessage.rowCount, 1, "Tenant A must read its own external ticket message");
    });

    await asTenant(organizationB, async () => {
      await app.query("INSERT INTO customers (id, organization_id, email, name) VALUES ($1, $2, 'b@example.test', 'B')", [customerB, organizationB]);
      await app.query("INSERT INTO meeting_types (id, organization_id, name, slug, duration_minutes) VALUES ($1, $2, 'Tenant B Meeting', $3, 45)", [meetingTypeB, organizationB, `tenant-b-${meetingTypeB}`]);
      await app.query("INSERT INTO action_executions (id, organization_id, tool_id, risk_level) VALUES ($1, $2, 'scheduling.cancel_booking', 'write')", [actionB, organizationB]);
      await app.query("INSERT INTO integration_connections (id, organization_id, provider, name, encrypted_credentials) VALUES ($1, $2, 'zendesk', 'Tenant B Zendesk', 'rls-test-encrypted-b')", [integrationB, organizationB]);
      await app.query("INSERT INTO integration_inbound_events (id, organization_id, connection_id, provider, invocation_id, event_type, payload) VALUES ($1, $2, $3, 'zendesk', 'inv-tenant-b', 'ticket.updated', '{}'::jsonb)", [inboundB, organizationB, integrationB]);
      await app.query("INSERT INTO tickets (id, organization_id, customer_id, ticket_number, subject, priority, status, tags) VALUES ($1, $2, $3, 9102, 'Tenant B ticket', 'normal', 'open', '[]'::jsonb)", [ticketB, organizationB, customerB]);
      await app.query("INSERT INTO external_actors (id, organization_id, connection_id, provider, external_id, role, display_name) VALUES ($1, $2, $3, 'zendesk', 'external-b', 'end-user', 'External B')", [externalActorB, organizationB, integrationB]);
      await app.query("INSERT INTO external_ticket_messages (id, organization_id, ticket_id, connection_id, actor_id, provider, external_message_id, content) VALUES ($1, $2, $3, $4, $5, 'zendesk', 'message-b', 'Tenant B external message')", [externalMessageB, organizationB, ticketB, integrationB, externalActorB]);
    });

    await asTenant(organizationA, async () => {
      const crossCustomer = await app.query("SELECT id FROM customers WHERE id = $1", [customerB]);
      assert.equal(crossCustomer.rowCount, 0, "Tenant A must not read Tenant B customers");
      const crossMeeting = await app.query("SELECT id FROM meeting_types WHERE id = $1", [meetingTypeB]);
      assert.equal(crossMeeting.rowCount, 0, "Tenant A must not read Tenant B meeting types");
      const crossAction = await app.query("SELECT id FROM action_executions WHERE id = $1", [actionB]);
      assert.equal(crossAction.rowCount, 0, "Tenant A must not read Tenant B action executions");
      const crossInbound = await app.query("SELECT id FROM integration_inbound_events WHERE id = $1", [inboundB]);
      assert.equal(crossInbound.rowCount, 0, "Tenant A must not read Tenant B inbound integration events");
      const crossActor = await app.query("SELECT id FROM external_actors WHERE id = $1", [externalActorB]);
      assert.equal(crossActor.rowCount, 0, "Tenant A must not read Tenant B external actors");
      const crossMessage = await app.query("SELECT id FROM external_ticket_messages WHERE id = $1", [externalMessageB]);
      assert.equal(crossMessage.rowCount, 0, "Tenant A must not read Tenant B external ticket messages");
      await assert.rejects(() => app.query("INSERT INTO external_actors (organization_id, connection_id, provider, external_id) VALUES ($1, $2, 'zendesk', 'cross-tenant-write')", [organizationB, integrationB]), /row-level security|violates/i);
    });

    console.log("Tenant RLS isolation integration test passed.");
  } finally {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationA, organizationB]]).catch(() => undefined);
    await app.end();
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
