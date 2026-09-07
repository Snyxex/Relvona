import "dotenv/config";
import { Client } from "pg";

async function main() {
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_team_id uuid;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL';
    ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS resolved_auto_close_hours integer;
    CREATE INDEX IF NOT EXISTS conversation_inbox_idx ON conversations (organization_id, state, priority, updated_at DESC);
    CREATE TABLE IF NOT EXISTS conversation_activities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, event_type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamp NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS conversation_timeline_idx ON conversation_activities (organization_id, conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS conversation_handoffs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, reason text NOT NULL, ai_confidence real, last_ai_attempt text, requested_priority text NOT NULL DEFAULT 'NORMAL', claimed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL, claimed_at timestamp, created_at timestamp NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS conversation_handoff_inbox_idx ON conversation_handoffs (organization_id, conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS conversation_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name text NOT NULL, color text NOT NULL DEFAULT 'slate', created_at timestamp NOT NULL DEFAULT now(), UNIQUE (organization_id, name));
    CREATE TABLE IF NOT EXISTS conversation_tag_links (conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, tag_id uuid NOT NULL REFERENCES conversation_tags(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, created_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY (conversation_id, tag_id));
    CREATE INDEX IF NOT EXISTS conversation_tag_filter_idx ON conversation_tag_links (organization_id, tag_id);
    CREATE TABLE IF NOT EXISTS agent_presence (organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'OFFLINE', updated_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, user_id));
  `);
} finally { await client.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
