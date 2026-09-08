import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required to configure PostgreSQL RLS");
const appRole = process.env.DATABASE_APP_USER || "supportai_app";
const appPassword = process.env.DATABASE_APP_PASSWORD;
if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(appRole) || !appPassword) throw new Error("DATABASE_APP_USER and DATABASE_APP_PASSWORD must configure the non-owner application login");

const tenantTables = [
  "knowledge_ingestion_jobs", "api_keys", "customers", "assistants", "assistant_versions", "knowledge_bases", "knowledge_sources", "document_chunks", "websites", "website_pages", "conversations", "conversation_messages", "message_feedback", "tickets", "ticket_comments", "analytics_events", "audit_logs", "organization_settings", "model_routing_rules", "conversation_activities", "conversation_handoffs", "conversation_tags", "conversation_tag_links", "agent_presence", "anonymous_visitors", "visitor_conversations", "visitor_memories", "customer_portal_accounts", "customer_portal_magic_links", "customer_portal_sessions", "customer_portal_visitor_links", "ticket_sla_policies", "ticket_case_metadata", "ticket_case_events", "calendar_connections", "meeting_types", "availability_rules", "bookings", "booking_events", "action_executions", "calendar_oauth_states", "conversation_scheduling_states", "knowledge_gaps", "knowledge_gap_signals", "webhook_subscriptions", "webhook_events", "webhook_deliveries", "integration_connections", "integration_sync_rules", "integration_sync_executions", "integration_inbound_events", "external_actors", "external_ticket_messages",
];

async function main() {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
    const passwordLiteral = (await client.query("SELECT quote_literal($1) AS value", [appPassword])).rows[0].value as string;
    if (role.rowCount) await client.query(`ALTER ROLE "${appRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${passwordLiteral}`);
    else await client.query(`CREATE ROLE "${appRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${passwordLiteral}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}"`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}"`);
    for (const table of tenantTables) {
      const exists = await client.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]);
      if (!exists.rows[0]?.table_name) continue;
      await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS supportai_tenant_isolation ON "${table}"`);
      await client.query(`CREATE POLICY supportai_tenant_isolation ON "${table}" USING (organization_id::text = current_setting('app.organization_id', true)) WITH CHECK (organization_id::text = current_setting('app.organization_id', true))`);
    }
    await client.query(`DROP FUNCTION IF EXISTS public.supportai_public_widget_assistant(uuid)`);
    await client.query(`CREATE OR REPLACE FUNCTION public.supportai_public_widget_assistant(target_id uuid, supplied_key text)
      RETURNS TABLE (id uuid, organization_id uuid, name text, welcome_message text, primary_color text, avatar_url text, handoff_enabled boolean, widget_allowed_origins jsonb, chat_page_enabled boolean, widget_settings jsonb)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT id, organization_id, name, welcome_message, primary_color, avatar_url, handoff_enabled, widget_allowed_origins, chat_page_enabled, widget_settings FROM public.assistants WHERE id = target_id AND widget_api_key = supplied_key
      $$`);
    await client.query(`DROP FUNCTION IF EXISTS public.supportai_public_widget_assistant_for_org(uuid)`);
    await client.query("REVOKE ALL ON FUNCTION public.supportai_public_widget_assistant(uuid, text) FROM PUBLIC");
    await client.query(`GRANT EXECUTE ON FUNCTION public.supportai_public_widget_assistant(uuid, text) TO "${appRole}"`);
    console.log("Enabled forced RLS policies for tenant-owned tables.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
