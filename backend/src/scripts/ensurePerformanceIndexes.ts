import pg from "pg";

const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

const statements = [
  `CREATE INDEX IF NOT EXISTS bookings_org_status_starts_idx
     ON bookings (organization_id, status, starts_at)`,
  `CREATE INDEX IF NOT EXISTS bookings_org_assignee_status_starts_idx
     ON bookings (organization_id, assigned_user_id, status, starts_at)`,
  `CREATE INDEX IF NOT EXISTS bookings_org_starts_idx
     ON bookings (organization_id, starts_at)`,
  `CREATE INDEX IF NOT EXISTS availability_rules_slot_lookup_idx
     ON availability_rules (organization_id, enabled, meeting_type_id, user_id, weekday)`,
  `CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx
     ON audit_logs (organization_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS booking_events_org_booking_created_idx
     ON booking_events (organization_id, booking_id, created_at DESC)`,
];

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
    console.log(`Ensured ${statements.length} performance indexes.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
