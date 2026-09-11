import { pool } from "../db/index.js";

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_server_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false,
      host text,
      port integer NOT NULL DEFAULT 587 CHECK (port > 0 AND port <= 65535),
      security text NOT NULL DEFAULT 'starttls' CHECK (security IN ('none', 'starttls', 'tls')),
      username text,
      password_encrypted text,
      from_email text,
      from_name text NOT NULL DEFAULT 'Relvona',
      reply_to text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mail_server_settings_org_unique ON mail_server_settings (organization_id)`);
}

main()
  .then(async () => { await pool.end(); })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
