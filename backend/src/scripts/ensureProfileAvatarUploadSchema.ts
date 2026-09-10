import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, closeDatabasePool } from "../db/index.js";

async function run() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS profile_avatar_uploads (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      storage_key text NOT NULL UNIQUE,
      mime_type text NOT NULL,
      expected_size integer NOT NULL,
      status text NOT NULL DEFAULT 'PENDING_UPLOAD',
      expires_at timestamp NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS profile_avatar_uploads_cleanup_idx
      ON profile_avatar_uploads (status, expires_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS profile_avatar_uploads_user_idx
      ON profile_avatar_uploads (user_id, status)
  `);
}

run()
  .then(() => console.log("[db] profile avatar upload registry ready"))
  .catch((error) => {
    console.error("[db] failed to ensure profile avatar upload registry", error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabasePool());
