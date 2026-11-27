import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required to configure PostgreSQL RLS");
const appRole = process.env.DATABASE_APP_USER || "supportai_app";
const appPassword = process.env.DATABASE_APP_PASSWORD;
if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(appRole) || !appPassword) throw new Error("DATABASE_APP_USER and DATABASE_APP_PASSWORD must configure the non-owner application login");

const tenantTables = [
  "organization_role_policies", "organization_invitations", "sso_login_states",
  "knowledge_ingestion_jobs", "api_keys", "customers", "assistants", "assistant_versions", "knowledge_bases", "knowledge_sources", "document_chunks", "websites", "website_pages", "conversations", "conversation_messages", "message_feedback", "tickets", "ticket_comments", "analytics_events", "audit_logs", "organization_settings", "model_routing_rules", "conversation_activities", "conversation_handoffs", "conversation_tags", "conversation_tag_links", "agent_presence", "employee_directory", "mail_server_settings", "anonymous_visitors", "visitor_conversations", "visitor_memories", "customer_portal_accounts", "customer_portal_magic_links", "customer_portal_sessions", "customer_portal_visitor_links", "ticket_sla_policies", "ticket_case_metadata", "ticket_case_events", "calendar_connections", "meeting_types", "availability_rules", "bookings", "booking_events", "booking_calendar_sync", "action_executions", "calendar_oauth_states", "conversation_scheduling_states", "knowledge_gaps", "knowledge_gap_signals", "knowledge_source_intelligence", "knowledge_retrieval_events", "knowledge_faq_drafts", "knowledge_collections", "source_knowledge_collections", "assistant_knowledge_collections", "webhook_subscriptions", "webhook_events", "webhook_deliveries", "integration_connections", "integration_sync_rules", "integration_sync_executions", "integration_inbound_events", "external_actors", "external_ticket_messages", "notification_settings", "notifications", "support_teams", "support_team_members", "ticket_routing", "sla_escalation_settings", "support_schedules", "support_absences", "support_automation_rules", "support_automation_runs",
];

async function main() {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // Role grants and RLS policies must commit or roll back together.
    await client.query("BEGIN");
    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
    const passwordLiteral = (await client.query("SELECT quote_literal($1) AS value", [appPassword])).rows[0].value as string;
    if (role.rowCount) await client.query(`ALTER ROLE "${appRole}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${passwordLiteral}`);
    else await client.query(`CREATE ROLE "${appRole}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${passwordLiteral}`);
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

    // A valid, high-entropy invitation token (SHA-256 hash) may be resolved
    // before an organization is known, but only within the current transaction.
    // Normal invitation management still requires the tenant policy above.
    await client.query("DROP POLICY IF EXISTS supportai_invitation_token_lookup ON public.organization_invitations");
    await client.query(
      `CREATE POLICY supportai_invitation_token_lookup ON public.organization_invitations
        FOR SELECT TO "${appRole}"
        USING (
          token_hash = current_setting('app.invitation_token_hash', true)
          AND token_hash ~ '^[a-f0-9]{64}
    // may append evidence but may not read, edit or delete it through tenant
    // endpoints. Role/privilege enforcement is independent of tenant RLS.
    const platformAuditExists = await client.query("SELECT to_regclass('public.platform_audit_logs') AS table_name");
    if (!platformAuditExists.rows[0]?.table_name) throw new Error("Global platform audit table missing; run db:migrate before enabling RLS");
    {
      await client.query("REVOKE ALL ON TABLE public.platform_audit_logs FROM PUBLIC");
      await client.query(`REVOKE ALL ON TABLE public.platform_audit_logs FROM "${appRole}"`);
      await client.query(`GRANT INSERT ON TABLE public.platform_audit_logs TO "${appRole}"`);
      await client.query("ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY");
      await client.query("ALTER TABLE public.platform_audit_logs FORCE ROW LEVEL SECURITY");
      await client.query("DROP POLICY IF EXISTS platform_audit_append_only ON public.platform_audit_logs");
      await client.query(`CREATE POLICY platform_audit_append_only ON public.platform_audit_logs FOR INSERT TO "${appRole}" WITH CHECK (true)`);
    }


    // Optional independent read-only attestor login. This is not the tenant
    // application account and MUST NOT inherit any application privileges.
    const auditReaderRole = process.env.DATABASE_PLATFORM_AUDIT_READER_USER?.trim();
    if (auditReaderRole) {
      if (
        !/^[a-z_][a-z0-9_]{0,62}$/i.test(auditReaderRole) ||
        auditReaderRole === appRole
      ) {
        throw new Error("Invalid independent platform audit reader role");
      }
      const reader = await client.query(
        "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1",
        [auditReaderRole],
      );
      if (
        !reader.rowCount ||
        reader.rows[0].rolsuper ||
        reader.rows[0].rolbypassrls ||
        reader.rows[0].rolcreatedb ||
        reader.rows[0].rolcreaterole
      ) {
        throw new Error("Audit reader must be an existing unprivileged login role");
      }
      const membership = await client.query(
        "SELECT pg_has_role($1, $2, 'MEMBER') AS reader_in_app, pg_has_role($2, $1, 'MEMBER') AS app_in_reader",
        [auditReaderRole, appRole],
      );
      if (membership.rows[0].reader_in_app || membership.rows[0].app_in_reader) {
        throw new Error("Audit reader and application roles must not inherit one another");
      }
      await client.query('GRANT USAGE ON SCHEMA public TO "' + auditReaderRole + '"');
      await client.query('GRANT SELECT ON TABLE public.platform_audit_logs TO "' + auditReaderRole + '"');
      await client.query("DROP POLICY IF EXISTS platform_audit_reader_select ON public.platform_audit_logs");
      await client.query(
        'CREATE POLICY platform_audit_reader_select ON public.platform_audit_logs FOR SELECT TO "' + auditReaderRole + '" USING (true)',
      );
      const privileges = await client.query(
        "SELECT has_table_privilege($1, 'public.platform_audit_logs', 'INSERT') AS ins, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'UPDATE') AS upd, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'DELETE') AS del, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'TRUNCATE') AS trunc",
        [auditReaderRole],
      );
      if (Object.values(privileges.rows[0]).some(Boolean)) {
        throw new Error("Audit reader has write privileges; revoke privileges and retry");
      }
    }

    const chunksExist = await client.query("SELECT to_regclass('public.document_chunks') AS table_name");
    const intelligenceExists = await client.query("SELECT to_regclass('public.knowledge_source_intelligence') AS table_name");
    if (chunksExist.rows[0]?.table_name && intelligenceExists.rows[0]?.table_name) {
      await client.query(`DROP POLICY IF EXISTS supportai_tenant_isolation ON document_chunks`);
      await client.query(`CREATE POLICY supportai_tenant_isolation ON document_chunks
        USING (
          organization_id::text = current_setting('app.organization_id', true)
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_source_intelligence ksi
            WHERE ksi.organization_id = document_chunks.organization_id
              AND ksi.source_id = document_chunks.source_id
              AND ksi.publication_status <> 'PUBLISHED'
          )
        )
        WITH CHECK (organization_id::text = current_setting('app.organization_id', true))`);
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

    await client.query(`CREATE OR REPLACE FUNCTION public.supportai_resolve_api_key(supplied_prefix text, supplied_hash text)
      RETURNS TABLE (id uuid, organization_id uuid, revoked_at timestamp without time zone, expires_at timestamp without time zone)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT k.id, k.organization_id, k.revoked_at, k.expires_at
        FROM public.api_keys k
        WHERE k.key_prefix = supplied_prefix AND k.key_hash = supplied_hash
        LIMIT 1
      $$`);
    await client.query("REVOKE ALL ON FUNCTION public.supportai_resolve_api_key(text, text) FROM PUBLIC");
    await client.query(`GRANT EXECUTE ON FUNCTION public.supportai_resolve_api_key(text, text) TO "${appRole}"`);

    await client.query("COMMIT");
    console.log("Enabled forced RLS policies and restricted public resolver functions.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

        )`,
    );

    // Entra's state hash is likewise a one-time bootstrap capability.
    // Only the matching state may be selected or marked consumed outside
    // the established tenant context. No raw cross-tenant table grants.
    await client.query("DROP POLICY IF EXISTS supportai_sso_state_lookup ON public.sso_login_states");
    await client.query(
      `CREATE POLICY supportai_sso_state_lookup ON public.sso_login_states
        FOR SELECT TO "${appRole}"
        USING (
          state_hash = current_setting('app.sso_state_hash', true)
          AND state_hash ~ '^[a-f0-9]{64}
    // may append evidence but may not read, edit or delete it through tenant
    // endpoints. Role/privilege enforcement is independent of tenant RLS.
    const platformAuditExists = await client.query("SELECT to_regclass('public.platform_audit_logs') AS table_name");
    if (!platformAuditExists.rows[0]?.table_name) throw new Error("Global platform audit table missing; run db:migrate before enabling RLS");
    {
      await client.query("REVOKE ALL ON TABLE public.platform_audit_logs FROM PUBLIC");
      await client.query(`REVOKE ALL ON TABLE public.platform_audit_logs FROM "${appRole}"`);
      await client.query(`GRANT INSERT ON TABLE public.platform_audit_logs TO "${appRole}"`);
      await client.query("ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY");
      await client.query("ALTER TABLE public.platform_audit_logs FORCE ROW LEVEL SECURITY");
      await client.query("DROP POLICY IF EXISTS platform_audit_append_only ON public.platform_audit_logs");
      await client.query(`CREATE POLICY platform_audit_append_only ON public.platform_audit_logs FOR INSERT TO "${appRole}" WITH CHECK (true)`);
    }


    // Optional independent read-only attestor login. This is not the tenant
    // application account and MUST NOT inherit any application privileges.
    const auditReaderRole = process.env.DATABASE_PLATFORM_AUDIT_READER_USER?.trim();
    if (auditReaderRole) {
      if (
        !/^[a-z_][a-z0-9_]{0,62}$/i.test(auditReaderRole) ||
        auditReaderRole === appRole
      ) {
        throw new Error("Invalid independent platform audit reader role");
      }
      const reader = await client.query(
        "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1",
        [auditReaderRole],
      );
      if (
        !reader.rowCount ||
        reader.rows[0].rolsuper ||
        reader.rows[0].rolbypassrls ||
        reader.rows[0].rolcreatedb ||
        reader.rows[0].rolcreaterole
      ) {
        throw new Error("Audit reader must be an existing unprivileged login role");
      }
      const membership = await client.query(
        "SELECT pg_has_role($1, $2, 'MEMBER') AS reader_in_app, pg_has_role($2, $1, 'MEMBER') AS app_in_reader",
        [auditReaderRole, appRole],
      );
      if (membership.rows[0].reader_in_app || membership.rows[0].app_in_reader) {
        throw new Error("Audit reader and application roles must not inherit one another");
      }
      await client.query('GRANT USAGE ON SCHEMA public TO "' + auditReaderRole + '"');
      await client.query('GRANT SELECT ON TABLE public.platform_audit_logs TO "' + auditReaderRole + '"');
      await client.query("DROP POLICY IF EXISTS platform_audit_reader_select ON public.platform_audit_logs");
      await client.query(
        'CREATE POLICY platform_audit_reader_select ON public.platform_audit_logs FOR SELECT TO "' + auditReaderRole + '" USING (true)',
      );
      const privileges = await client.query(
        "SELECT has_table_privilege($1, 'public.platform_audit_logs', 'INSERT') AS ins, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'UPDATE') AS upd, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'DELETE') AS del, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'TRUNCATE') AS trunc",
        [auditReaderRole],
      );
      if (Object.values(privileges.rows[0]).some(Boolean)) {
        throw new Error("Audit reader has write privileges; revoke privileges and retry");
      }
    }

    const chunksExist = await client.query("SELECT to_regclass('public.document_chunks') AS table_name");
    const intelligenceExists = await client.query("SELECT to_regclass('public.knowledge_source_intelligence') AS table_name");
    if (chunksExist.rows[0]?.table_name && intelligenceExists.rows[0]?.table_name) {
      await client.query(`DROP POLICY IF EXISTS supportai_tenant_isolation ON document_chunks`);
      await client.query(`CREATE POLICY supportai_tenant_isolation ON document_chunks
        USING (
          organization_id::text = current_setting('app.organization_id', true)
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_source_intelligence ksi
            WHERE ksi.organization_id = document_chunks.organization_id
              AND ksi.source_id = document_chunks.source_id
              AND ksi.publication_status <> 'PUBLISHED'
          )
        )
        WITH CHECK (organization_id::text = current_setting('app.organization_id', true))`);
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

    await client.query(`CREATE OR REPLACE FUNCTION public.supportai_resolve_api_key(supplied_prefix text, supplied_hash text)
      RETURNS TABLE (id uuid, organization_id uuid, revoked_at timestamp without time zone, expires_at timestamp without time zone)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT k.id, k.organization_id, k.revoked_at, k.expires_at
        FROM public.api_keys k
        WHERE k.key_prefix = supplied_prefix AND k.key_hash = supplied_hash
        LIMIT 1
      $$`);
    await client.query("REVOKE ALL ON FUNCTION public.supportai_resolve_api_key(text, text) FROM PUBLIC");
    await client.query(`GRANT EXECUTE ON FUNCTION public.supportai_resolve_api_key(text, text) TO "${appRole}"`);

    await client.query("COMMIT");
    console.log("Enabled forced RLS policies and restricted public resolver functions.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

        )`,
    );
    await client.query("DROP POLICY IF EXISTS supportai_sso_state_consume ON public.sso_login_states");
    await client.query(
      `CREATE POLICY supportai_sso_state_consume ON public.sso_login_states
        FOR UPDATE TO "${appRole}"
        USING (
          state_hash = current_setting('app.sso_state_hash', true)
          AND state_hash ~ '^[a-f0-9]{64}
    // may append evidence but may not read, edit or delete it through tenant
    // endpoints. Role/privilege enforcement is independent of tenant RLS.
    const platformAuditExists = await client.query("SELECT to_regclass('public.platform_audit_logs') AS table_name");
    if (!platformAuditExists.rows[0]?.table_name) throw new Error("Global platform audit table missing; run db:migrate before enabling RLS");
    {
      await client.query("REVOKE ALL ON TABLE public.platform_audit_logs FROM PUBLIC");
      await client.query(`REVOKE ALL ON TABLE public.platform_audit_logs FROM "${appRole}"`);
      await client.query(`GRANT INSERT ON TABLE public.platform_audit_logs TO "${appRole}"`);
      await client.query("ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY");
      await client.query("ALTER TABLE public.platform_audit_logs FORCE ROW LEVEL SECURITY");
      await client.query("DROP POLICY IF EXISTS platform_audit_append_only ON public.platform_audit_logs");
      await client.query(`CREATE POLICY platform_audit_append_only ON public.platform_audit_logs FOR INSERT TO "${appRole}" WITH CHECK (true)`);
    }


    // Optional independent read-only attestor login. This is not the tenant
    // application account and MUST NOT inherit any application privileges.
    const auditReaderRole = process.env.DATABASE_PLATFORM_AUDIT_READER_USER?.trim();
    if (auditReaderRole) {
      if (
        !/^[a-z_][a-z0-9_]{0,62}$/i.test(auditReaderRole) ||
        auditReaderRole === appRole
      ) {
        throw new Error("Invalid independent platform audit reader role");
      }
      const reader = await client.query(
        "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1",
        [auditReaderRole],
      );
      if (
        !reader.rowCount ||
        reader.rows[0].rolsuper ||
        reader.rows[0].rolbypassrls ||
        reader.rows[0].rolcreatedb ||
        reader.rows[0].rolcreaterole
      ) {
        throw new Error("Audit reader must be an existing unprivileged login role");
      }
      const membership = await client.query(
        "SELECT pg_has_role($1, $2, 'MEMBER') AS reader_in_app, pg_has_role($2, $1, 'MEMBER') AS app_in_reader",
        [auditReaderRole, appRole],
      );
      if (membership.rows[0].reader_in_app || membership.rows[0].app_in_reader) {
        throw new Error("Audit reader and application roles must not inherit one another");
      }
      await client.query('GRANT USAGE ON SCHEMA public TO "' + auditReaderRole + '"');
      await client.query('GRANT SELECT ON TABLE public.platform_audit_logs TO "' + auditReaderRole + '"');
      await client.query("DROP POLICY IF EXISTS platform_audit_reader_select ON public.platform_audit_logs");
      await client.query(
        'CREATE POLICY platform_audit_reader_select ON public.platform_audit_logs FOR SELECT TO "' + auditReaderRole + '" USING (true)',
      );
      const privileges = await client.query(
        "SELECT has_table_privilege($1, 'public.platform_audit_logs', 'INSERT') AS ins, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'UPDATE') AS upd, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'DELETE') AS del, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'TRUNCATE') AS trunc",
        [auditReaderRole],
      );
      if (Object.values(privileges.rows[0]).some(Boolean)) {
        throw new Error("Audit reader has write privileges; revoke privileges and retry");
      }
    }

    const chunksExist = await client.query("SELECT to_regclass('public.document_chunks') AS table_name");
    const intelligenceExists = await client.query("SELECT to_regclass('public.knowledge_source_intelligence') AS table_name");
    if (chunksExist.rows[0]?.table_name && intelligenceExists.rows[0]?.table_name) {
      await client.query(`DROP POLICY IF EXISTS supportai_tenant_isolation ON document_chunks`);
      await client.query(`CREATE POLICY supportai_tenant_isolation ON document_chunks
        USING (
          organization_id::text = current_setting('app.organization_id', true)
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_source_intelligence ksi
            WHERE ksi.organization_id = document_chunks.organization_id
              AND ksi.source_id = document_chunks.source_id
              AND ksi.publication_status <> 'PUBLISHED'
          )
        )
        WITH CHECK (organization_id::text = current_setting('app.organization_id', true))`);
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

    await client.query(`CREATE OR REPLACE FUNCTION public.supportai_resolve_api_key(supplied_prefix text, supplied_hash text)
      RETURNS TABLE (id uuid, organization_id uuid, revoked_at timestamp without time zone, expires_at timestamp without time zone)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT k.id, k.organization_id, k.revoked_at, k.expires_at
        FROM public.api_keys k
        WHERE k.key_prefix = supplied_prefix AND k.key_hash = supplied_hash
        LIMIT 1
      $$`);
    await client.query("REVOKE ALL ON FUNCTION public.supportai_resolve_api_key(text, text) FROM PUBLIC");
    await client.query(`GRANT EXECUTE ON FUNCTION public.supportai_resolve_api_key(text, text) TO "${appRole}"`);

    await client.query("COMMIT");
    console.log("Enabled forced RLS policies and restricted public resolver functions.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

        )
        WITH CHECK (
          state_hash = current_setting('app.sso_state_hash', true)
          AND state_hash ~ '^[a-f0-9]{64}
    // may append evidence but may not read, edit or delete it through tenant
    // endpoints. Role/privilege enforcement is independent of tenant RLS.
    const platformAuditExists = await client.query("SELECT to_regclass('public.platform_audit_logs') AS table_name");
    if (!platformAuditExists.rows[0]?.table_name) throw new Error("Global platform audit table missing; run db:migrate before enabling RLS");
    {
      await client.query("REVOKE ALL ON TABLE public.platform_audit_logs FROM PUBLIC");
      await client.query(`REVOKE ALL ON TABLE public.platform_audit_logs FROM "${appRole}"`);
      await client.query(`GRANT INSERT ON TABLE public.platform_audit_logs TO "${appRole}"`);
      await client.query("ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY");
      await client.query("ALTER TABLE public.platform_audit_logs FORCE ROW LEVEL SECURITY");
      await client.query("DROP POLICY IF EXISTS platform_audit_append_only ON public.platform_audit_logs");
      await client.query(`CREATE POLICY platform_audit_append_only ON public.platform_audit_logs FOR INSERT TO "${appRole}" WITH CHECK (true)`);
    }


    // Optional independent read-only attestor login. This is not the tenant
    // application account and MUST NOT inherit any application privileges.
    const auditReaderRole = process.env.DATABASE_PLATFORM_AUDIT_READER_USER?.trim();
    if (auditReaderRole) {
      if (
        !/^[a-z_][a-z0-9_]{0,62}$/i.test(auditReaderRole) ||
        auditReaderRole === appRole
      ) {
        throw new Error("Invalid independent platform audit reader role");
      }
      const reader = await client.query(
        "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1",
        [auditReaderRole],
      );
      if (
        !reader.rowCount ||
        reader.rows[0].rolsuper ||
        reader.rows[0].rolbypassrls ||
        reader.rows[0].rolcreatedb ||
        reader.rows[0].rolcreaterole
      ) {
        throw new Error("Audit reader must be an existing unprivileged login role");
      }
      const membership = await client.query(
        "SELECT pg_has_role($1, $2, 'MEMBER') AS reader_in_app, pg_has_role($2, $1, 'MEMBER') AS app_in_reader",
        [auditReaderRole, appRole],
      );
      if (membership.rows[0].reader_in_app || membership.rows[0].app_in_reader) {
        throw new Error("Audit reader and application roles must not inherit one another");
      }
      await client.query('GRANT USAGE ON SCHEMA public TO "' + auditReaderRole + '"');
      await client.query('GRANT SELECT ON TABLE public.platform_audit_logs TO "' + auditReaderRole + '"');
      await client.query("DROP POLICY IF EXISTS platform_audit_reader_select ON public.platform_audit_logs");
      await client.query(
        'CREATE POLICY platform_audit_reader_select ON public.platform_audit_logs FOR SELECT TO "' + auditReaderRole + '" USING (true)',
      );
      const privileges = await client.query(
        "SELECT has_table_privilege($1, 'public.platform_audit_logs', 'INSERT') AS ins, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'UPDATE') AS upd, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'DELETE') AS del, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'TRUNCATE') AS trunc",
        [auditReaderRole],
      );
      if (Object.values(privileges.rows[0]).some(Boolean)) {
        throw new Error("Audit reader has write privileges; revoke privileges and retry");
      }
    }

    const chunksExist = await client.query("SELECT to_regclass('public.document_chunks') AS table_name");
    const intelligenceExists = await client.query("SELECT to_regclass('public.knowledge_source_intelligence') AS table_name");
    if (chunksExist.rows[0]?.table_name && intelligenceExists.rows[0]?.table_name) {
      await client.query(`DROP POLICY IF EXISTS supportai_tenant_isolation ON document_chunks`);
      await client.query(`CREATE POLICY supportai_tenant_isolation ON document_chunks
        USING (
          organization_id::text = current_setting('app.organization_id', true)
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_source_intelligence ksi
            WHERE ksi.organization_id = document_chunks.organization_id
              AND ksi.source_id = document_chunks.source_id
              AND ksi.publication_status <> 'PUBLISHED'
          )
        )
        WITH CHECK (organization_id::text = current_setting('app.organization_id', true))`);
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

    await client.query(`CREATE OR REPLACE FUNCTION public.supportai_resolve_api_key(supplied_prefix text, supplied_hash text)
      RETURNS TABLE (id uuid, organization_id uuid, revoked_at timestamp without time zone, expires_at timestamp without time zone)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT k.id, k.organization_id, k.revoked_at, k.expires_at
        FROM public.api_keys k
        WHERE k.key_prefix = supplied_prefix AND k.key_hash = supplied_hash
        LIMIT 1
      $$`);
    await client.query("REVOKE ALL ON FUNCTION public.supportai_resolve_api_key(text, text) FROM PUBLIC");
    await client.query(`GRANT EXECUTE ON FUNCTION public.supportai_resolve_api_key(text, text) TO "${appRole}"`);

    await client.query("COMMIT");
    console.log("Enabled forced RLS policies and restricted public resolver functions.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

        )`,
    );

    // Global platform audit events have no organization_id. The application
    // may append evidence but may not read, edit or delete it through tenant
    // endpoints. Role/privilege enforcement is independent of tenant RLS.
    const platformAuditExists = await client.query("SELECT to_regclass('public.platform_audit_logs') AS table_name");
    if (!platformAuditExists.rows[0]?.table_name) throw new Error("Global platform audit table missing; run db:migrate before enabling RLS");
    {
      await client.query("REVOKE ALL ON TABLE public.platform_audit_logs FROM PUBLIC");
      await client.query(`REVOKE ALL ON TABLE public.platform_audit_logs FROM "${appRole}"`);
      await client.query(`GRANT INSERT ON TABLE public.platform_audit_logs TO "${appRole}"`);
      await client.query("ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY");
      await client.query("ALTER TABLE public.platform_audit_logs FORCE ROW LEVEL SECURITY");
      await client.query("DROP POLICY IF EXISTS platform_audit_append_only ON public.platform_audit_logs");
      await client.query(`CREATE POLICY platform_audit_append_only ON public.platform_audit_logs FOR INSERT TO "${appRole}" WITH CHECK (true)`);
    }


    // Optional independent read-only attestor login. This is not the tenant
    // application account and MUST NOT inherit any application privileges.
    const auditReaderRole = process.env.DATABASE_PLATFORM_AUDIT_READER_USER?.trim();
    if (auditReaderRole) {
      if (
        !/^[a-z_][a-z0-9_]{0,62}$/i.test(auditReaderRole) ||
        auditReaderRole === appRole
      ) {
        throw new Error("Invalid independent platform audit reader role");
      }
      const reader = await client.query(
        "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1",
        [auditReaderRole],
      );
      if (
        !reader.rowCount ||
        reader.rows[0].rolsuper ||
        reader.rows[0].rolbypassrls ||
        reader.rows[0].rolcreatedb ||
        reader.rows[0].rolcreaterole
      ) {
        throw new Error("Audit reader must be an existing unprivileged login role");
      }
      const membership = await client.query(
        "SELECT pg_has_role($1, $2, 'MEMBER') AS reader_in_app, pg_has_role($2, $1, 'MEMBER') AS app_in_reader",
        [auditReaderRole, appRole],
      );
      if (membership.rows[0].reader_in_app || membership.rows[0].app_in_reader) {
        throw new Error("Audit reader and application roles must not inherit one another");
      }
      await client.query('GRANT USAGE ON SCHEMA public TO "' + auditReaderRole + '"');
      await client.query('GRANT SELECT ON TABLE public.platform_audit_logs TO "' + auditReaderRole + '"');
      await client.query("DROP POLICY IF EXISTS platform_audit_reader_select ON public.platform_audit_logs");
      await client.query(
        'CREATE POLICY platform_audit_reader_select ON public.platform_audit_logs FOR SELECT TO "' + auditReaderRole + '" USING (true)',
      );
      const privileges = await client.query(
        "SELECT has_table_privilege($1, 'public.platform_audit_logs', 'INSERT') AS ins, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'UPDATE') AS upd, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'DELETE') AS del, " +
        "has_table_privilege($1, 'public.platform_audit_logs', 'TRUNCATE') AS trunc",
        [auditReaderRole],
      );
      if (Object.values(privileges.rows[0]).some(Boolean)) {
        throw new Error("Audit reader has write privileges; revoke privileges and retry");
      }
    }

    const chunksExist = await client.query("SELECT to_regclass('public.document_chunks') AS table_name");
    const intelligenceExists = await client.query("SELECT to_regclass('public.knowledge_source_intelligence') AS table_name");
    if (chunksExist.rows[0]?.table_name && intelligenceExists.rows[0]?.table_name) {
      await client.query(`DROP POLICY IF EXISTS supportai_tenant_isolation ON document_chunks`);
      await client.query(`CREATE POLICY supportai_tenant_isolation ON document_chunks
        USING (
          organization_id::text = current_setting('app.organization_id', true)
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_source_intelligence ksi
            WHERE ksi.organization_id = document_chunks.organization_id
              AND ksi.source_id = document_chunks.source_id
              AND ksi.publication_status <> 'PUBLISHED'
          )
        )
        WITH CHECK (organization_id::text = current_setting('app.organization_id', true))`);
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

    await client.query(`CREATE OR REPLACE FUNCTION public.supportai_resolve_api_key(supplied_prefix text, supplied_hash text)
      RETURNS TABLE (id uuid, organization_id uuid, revoked_at timestamp without time zone, expires_at timestamp without time zone)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT k.id, k.organization_id, k.revoked_at, k.expires_at
        FROM public.api_keys k
        WHERE k.key_prefix = supplied_prefix AND k.key_hash = supplied_hash
        LIMIT 1
      $$`);
    await client.query("REVOKE ALL ON FUNCTION public.supportai_resolve_api_key(text, text) FROM PUBLIC");
    await client.query(`GRANT EXECUTE ON FUNCTION public.supportai_resolve_api_key(text, text) TO "${appRole}"`);

    await client.query("COMMIT");
    console.log("Enabled forced RLS policies and restricted public resolver functions.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
