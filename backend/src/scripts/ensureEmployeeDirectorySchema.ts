import { pool } from "../db/index.js";

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_directory (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      display_name text NOT NULL,
      email text,
      phone text,
      department text,
      job_title text,
      skills jsonb NOT NULL DEFAULT '[]'::jsonb,
      notes text,
      ai_visible boolean NOT NULL DEFAULT true,
      expose_email_to_customer boolean NOT NULL DEFAULT false,
      expose_phone_to_customer boolean NOT NULL DEFAULT false,
      allow_direct_handoff boolean NOT NULL DEFAULT false,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS employee_directory_org_name_idx ON employee_directory (organization_id, display_name)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS employee_directory_org_user_unique ON employee_directory (organization_id, user_id) WHERE user_id IS NOT NULL`);
}

main()
  .then(async () => { await pool.end(); })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
