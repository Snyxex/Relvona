import pg from "pg";

const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // Keep additive compatibility migrations explicit and idempotent. Existing
    // databases may predate columns that were added after the initial Drizzle
    // snapshot, and `drizzle-kit push` can require interactive decisions.
    await client.query("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'de'");
    await client.query("ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'");
    await client.query("ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS github_issue_number integer");
    await client.query("ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS github_issue_url text");
    await client.query("ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS github_issue_error text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS github_issues_enabled boolean NOT NULL DEFAULT false");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS github_repository text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS github_token_encrypted text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS active_directory_enabled boolean NOT NULL DEFAULT false");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS active_directory_url text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS active_directory_base_dn text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS active_directory_bind_dn text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS active_directory_bind_password_encrypted text");
    await client.query("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'");
    await client.query("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false");
    await client.query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'");
    await client.query("ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'");
    await client.query("ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS joined_at timestamp NOT NULL DEFAULT now()");
    // Never silently delete legacy memberships. Fail with a precise migration
    // error if cleanup is required before enforcing tenant membership uniqueness.
    const duplicates = await client.query("SELECT organization_id, user_id FROM public.organization_members GROUP BY organization_id, user_id HAVING count(*) > 1 LIMIT 1");
    if (duplicates.rowCount) throw new Error(`Cannot create org_user_unique while duplicate memberships exist for organization ${duplicates.rows[0].organization_id}`);
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS org_user_unique ON public.organization_members (organization_id, user_id)");
    await client.query("CREATE TABLE IF NOT EXISTS public.organization_dashboard_domains (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, domain text NOT NULL UNIQUE, verification_token text NOT NULL UNIQUE, verified_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())");
    await client.query("CREATE INDEX IF NOT EXISTS dashboard_domain_org_idx ON public.organization_dashboard_domains (organization_id)");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS local_login_enabled boolean NOT NULL DEFAULT true");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS invitation_enabled boolean NOT NULL DEFAULT true");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS sso_enabled boolean NOT NULL DEFAULT false");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS entra_tenant_id text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS entra_client_id text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS entra_client_secret_encrypted text");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS allowed_domains jsonb NOT NULL DEFAULT '[]'::jsonb");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS auto_join_enabled boolean NOT NULL DEFAULT false");
    await client.query("ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS default_auto_join_role text NOT NULL DEFAULT 'agent'");
    await client.query("CREATE TABLE IF NOT EXISTS public.organization_invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, email text NOT NULL, role text NOT NULL, token_hash text NOT NULL UNIQUE, invited_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL, expires_at timestamp NOT NULL, accepted_at timestamp, revoked_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())");
    await client.query("CREATE INDEX IF NOT EXISTS org_invitation_idx ON public.organization_invitations (organization_id, email, expires_at)");
    await client.query("CREATE TABLE IF NOT EXISTS public.platform_support_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform_admin_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, reason text NOT NULL, started_at timestamp NOT NULL DEFAULT now(), expires_at timestamp NOT NULL, ended_at timestamp, created_at timestamp NOT NULL DEFAULT now())");
    await client.query("CREATE TABLE IF NOT EXISTS public.sso_login_states (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, state_hash text NOT NULL UNIQUE, nonce text NOT NULL, expires_at timestamp NOT NULL, consumed_at timestamp, created_at timestamp NOT NULL DEFAULT now())");
    await client.query("CREATE INDEX IF NOT EXISTS sso_state_expiry_idx ON public.sso_login_states (expires_at)");
    await client.query("CREATE TABLE IF NOT EXISTS public.user_external_identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, provider text NOT NULL, issuer text NOT NULL, subject text NOT NULL, email text NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS external_identity_provider_subject_unique ON public.user_external_identities (provider, issuer, subject)");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS external_identity_user_provider_unique ON public.user_external_identities (user_id, provider, issuer)");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS open_conversation_ticket_unique ON public.tickets (organization_id, conversation_id) WHERE source = 'ai_escalation' AND conversation_id IS NOT NULL AND status NOT IN ('resolved', 'closed')");
    await client.query("CREATE TABLE IF NOT EXISTS public.auth_sessions (id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, token text NOT NULL UNIQUE, expires_at timestamp NOT NULL, ip_address text, user_agent text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())");
    await client.query("CREATE INDEX IF NOT EXISTS auth_session_user_idx ON public.auth_sessions (user_id, expires_at)");
    await client.query("CREATE TABLE IF NOT EXISTS public.auth_accounts (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, issuer text NOT NULL, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, access_token text, refresh_token text, id_token text, access_token_expires_at timestamp, refresh_token_expires_at timestamp, scope text, password text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())");
    await client.query("ALTER TABLE public.auth_accounts ADD COLUMN IF NOT EXISTS issuer text");
    await client.query("UPDATE public.auth_accounts SET issuer = 'local:credential' WHERE issuer IS NULL AND provider_id = 'credential'");
    await client.query("ALTER TABLE public.auth_accounts ALTER COLUMN issuer SET NOT NULL");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS auth_account_provider_unique ON public.auth_accounts (provider_id, account_id)");
    await client.query("CREATE INDEX IF NOT EXISTS auth_account_user_idx ON public.auth_accounts (user_id)");
    await client.query("CREATE TABLE IF NOT EXISTS public.auth_verifications (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())");
    await client.query("CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx ON public.auth_verifications (identifier, expires_at)");
    // Preserve existing user UUIDs and bcrypt hashes. Better Auth reads the
    // credential account from this table after the application switches its
    // middleware to Better Auth sessions.
    await client.query("UPDATE public.users SET email_verified = true WHERE email_verified = false AND password_hash IS NOT NULL");
    await client.query("INSERT INTO public.auth_accounts (id, account_id, provider_id, issuer, user_id, password, created_at, updated_at) SELECT gen_random_uuid()::text, u.id::text, 'credential', 'local:credential', u.id, u.password_hash, now(), now() FROM public.users u WHERE NOT EXISTS (SELECT 1 FROM public.auth_accounts a WHERE a.provider_id = 'credential' AND a.user_id = u.id)");

    // Older installations used a smaller api_keys table. Add the hashing and
    // lifecycle fields before legacy organization keys are copied into it.
    await client.query("ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS key_prefix text");
    await client.query("ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS scopes jsonb NOT NULL DEFAULT '[\"*\"]'::jsonb");
    await client.query("ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS expires_at timestamp");
    await client.query("ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS revoked_at timestamp");
    await client.query("UPDATE public.api_keys SET key_prefix = 'legacy_' || id::text WHERE key_prefix IS NULL");
    await client.query("ALTER TABLE public.api_keys ALTER COLUMN key_prefix SET NOT NULL");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS api_key_prefix_unique ON public.api_keys (key_prefix)");
    console.log("Verified application compatibility schema.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error("Application schema setup failed:", error); process.exitCode = 1; });
