import "dotenv/config";
import pg from "pg";
import { objectStorage } from "../services/objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";

const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

const PAGE_SIZE = 250;

type FileObjectRow = {
  id: string;
  organization_id: string;
  storage_key: string;
  status: string;
};

type AvatarRow = {
  id: string;
  avatar_url: string;
};

function avatarKey(reference: string) {
  if (!reference.startsWith("storage://")) return null;
  const key = reference.slice("storage://".length);
  return /^users\/[0-9a-f-]{36}\/avatar\/[0-9a-f-]{36}\/original$/i.test(key) ? key : null;
}

async function run() {
  const config = objectStorageConfig();
  if (!config.enabled) throw new Error("Object storage is disabled");

  const client = new pg.Client({ connectionString });
  await client.connect();

  let checked = 0;
  let missing = 0;
  let invalidReferences = 0;
  let cursor: string | null = null;

  try {
    await objectStorage().ensureReady();

    while (true) {
      const values: unknown[] = [];
      let cursorClause = "";
      if (cursor) {
        values.push(cursor);
        cursorClause = `AND id > $${values.length}::uuid`;
      }
      values.push(PAGE_SIZE);

      const result = await client.query<FileObjectRow>(
        `SELECT id, organization_id, storage_key, status
         FROM public.file_objects
         WHERE status IN ('UPLOADED', 'READY')
         ${cursorClause}
         ORDER BY id
         LIMIT $${values.length}`,
        values,
      );
      if (!result.rows.length) break;

      for (const row of result.rows) {
        checked += 1;
        try {
          if (!(await objectStorage().objectExists(row.storage_key))) {
            missing += 1;
            console.error(`[storage-verify] missing file object id=${row.id} organization=${row.organization_id} key=${row.storage_key}`);
          }
        } catch (error) {
          missing += 1;
          console.error(`[storage-verify] unable to verify file object id=${row.id} key=${row.storage_key}`, error);
        }
      }

      cursor = result.rows[result.rows.length - 1].id;
      if (result.rows.length < PAGE_SIZE) break;
    }

    const avatars = await client.query<AvatarRow>(
      `SELECT id, avatar_url
       FROM public.users
       WHERE avatar_url LIKE 'storage://users/%'`,
    );

    for (const user of avatars.rows) {
      const key = avatarKey(user.avatar_url);
      if (!key) {
        invalidReferences += 1;
        console.error(`[storage-verify] invalid avatar storage reference user=${user.id}`);
        continue;
      }
      checked += 1;
      try {
        if (!(await objectStorage().objectExists(key))) {
          missing += 1;
          console.error(`[storage-verify] missing avatar user=${user.id} key=${key}`);
        }
      } catch (error) {
        missing += 1;
        console.error(`[storage-verify] unable to verify avatar user=${user.id} key=${key}`, error);
      }
    }

    console.log(`[storage-verify] checked=${checked} missing=${missing} invalidReferences=${invalidReferences}`);
    if (missing || invalidReferences) process.exitCode = 2;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("[storage-verify] failed", error);
  process.exitCode = 1;
});
