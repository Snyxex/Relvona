import crypto from "node:crypto";
import { like, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { objectStorage } from "../services/objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";
import { FileSecurity } from "../services/fileSecurity.js";

const MAX_AVATAR_BYTES = 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function run() {
  const config = objectStorageConfig();
  if (!config.enabled || !["s3", "rustfs"].includes(config.provider)) {
    console.log("[avatar-migration] object storage direct uploads are disabled; skipping legacy avatar migration");
    return;
  }

  const candidates = await db
    .select({ id: users.id, avatarUrl: users.avatarUrl })
    .from(users)
    .where(like(users.avatarUrl, "data:image/%"));

  let migrated = 0;
  let skipped = 0;

  for (const user of candidates) {
    const match = user.avatarUrl?.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      skipped += 1;
      console.warn(`[avatar-migration] skipping malformed avatar for user ${user.id}`);
      continue;
    }

    const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
    const body = Buffer.from(match[2], "base64");
    if (!EXTENSIONS[mimeType] || body.length < 1 || body.length > MAX_AVATAR_BYTES) {
      skipped += 1;
      console.warn(`[avatar-migration] skipping invalid avatar size/type for user ${user.id}`);
      continue;
    }

    const validation = FileSecurity.validateUploadedFile(body, `avatar.${EXTENSIONS[mimeType]}`, mimeType);
    if (!validation.isValid) {
      skipped += 1;
      console.warn(`[avatar-migration] skipping avatar with invalid file signature for user ${user.id}`);
      continue;
    }

    const objectId = crypto.randomUUID();
    const key = `users/${user.id}/avatar/${objectId}/original`;
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");

    try {
      await objectStorage().putObject(key, {
        body,
        contentType: mimeType,
        contentLength: body.length,
        sha256,
      });
      await db
        .update(users)
        .set({ avatarUrl: `storage://${key}`, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      migrated += 1;
    } catch (error) {
      await objectStorage().deleteObject(key).catch(() => undefined);
      throw error;
    }
  }

  console.log(`[avatar-migration] migrated=${migrated} skipped=${skipped}`);
}

run().catch((error) => {
  console.error("[avatar-migration] failed", error);
  process.exitCode = 1;
});
