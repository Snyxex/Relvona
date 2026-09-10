import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { objectStorage } from "./objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";
import { FileSecurity } from "./fileSecurity.js";
import { metrics } from "../observability/metrics.js";

const MAX_AVATAR_BYTES = 1024 * 1024;
const STORAGE_PREFIX = "storage://";
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

type AvatarUploadRow = {
  id: string;
  user_id: string;
  storage_key: string;
  mime_type: string;
  expected_size: number;
  status: string;
  expires_at: Date;
};

function directUploadAvailable() {
  const provider = objectStorageConfig().provider;
  return provider === "s3" || provider === "rustfs";
}

function avatarKey(userId: string, objectId: string) {
  return `users/${userId}/avatar/${objectId}/original`;
}

function storageReference(key: string) {
  return `${STORAGE_PREFIX}${key}`;
}

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export class ProfileAvatarService {
  static isStorageReference(value: string | null | undefined): value is string {
    return typeof value === "string" && value.startsWith(STORAGE_PREFIX);
  }

  static keyFromReference(reference: string) {
    if (!this.isStorageReference(reference)) throw new Error("AVATAR_REFERENCE_INVALID");
    const key = reference.slice(STORAGE_PREFIX.length);
    if (!/^users\/[0-9a-f-]{36}\/avatar\/[0-9a-f-]{36}\/original$/i.test(key)) {
      throw new Error("AVATAR_REFERENCE_INVALID");
    }
    return key;
  }

  static async resolvePublicUrl(reference: string | null | undefined) {
    if (!reference || !this.isStorageReference(reference)) return reference ?? null;
    try {
      return await objectStorage().createSignedDownloadUrl(
        this.keyFromReference(reference),
        objectStorageConfig().signedUrlTtlSeconds,
      );
    } catch {
      return null;
    }
  }

  static async createUploadIntent(userId: string, mimeType: string, size: number) {
    if (!directUploadAvailable()) throw new Error("AVATAR_STORAGE_UNAVAILABLE");
    if (!ALLOWED_TYPES.has(mimeType) || !Number.isInteger(size) || size < 1 || size > MAX_AVATAR_BYTES) {
      throw new Error("AVATAR_INVALID");
    }

    const objectId = crypto.randomUUID();
    const key = avatarKey(userId, objectId);
    const expiresAt = new Date(Date.now() + objectStorageConfig().signedUrlTtlSeconds * 1_000);

    await db.execute(sql`
      INSERT INTO profile_avatar_uploads (id, user_id, storage_key, mime_type, expected_size, status, expires_at)
      VALUES (${objectId}::uuid, ${userId}::uuid, ${key}, ${mimeType}, ${size}, 'PENDING_UPLOAD', ${expiresAt})
    `);

    try {
      const uploadUrl = await objectStorage().createSignedUploadUrl(
        key,
        objectStorageConfig().signedUrlTtlSeconds,
        { contentType: mimeType, contentLength: size },
      );
      return { objectId, uploadUrl, expiresInSeconds: objectStorageConfig().signedUrlTtlSeconds };
    } catch (error) {
      await db.execute(sql`DELETE FROM profile_avatar_uploads WHERE id = ${objectId}::uuid AND user_id = ${userId}::uuid`);
      throw error;
    }
  }

  static async finalize(userId: string, objectId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(objectId)) throw new Error("AVATAR_INVALID");

    const lookup = await db.execute(sql`
      SELECT id, user_id, storage_key, mime_type, expected_size, status, expires_at
      FROM profile_avatar_uploads
      WHERE id = ${objectId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `);
    const upload = rowsOf<AvatarUploadRow>(lookup)[0];
    if (!upload || upload.status !== "PENDING_UPLOAD") throw new Error("AVATAR_INVALID");
    if (new Date(upload.expires_at).getTime() <= Date.now()) {
      await db.execute(sql`
        UPDATE profile_avatar_uploads SET status = 'EXPIRED', updated_at = now()
        WHERE id = ${objectId}::uuid AND user_id = ${userId}::uuid
      `);
      throw new Error("AVATAR_UPLOAD_EXPIRED");
    }

    const key = avatarKey(userId, objectId);
    if (upload.storage_key !== key) throw new Error("AVATAR_INVALID");

    try {
      const metadata = await objectStorage().getObjectMetadata(key);
      if (
        metadata.contentType !== upload.mime_type ||
        metadata.contentLength !== Number(upload.expected_size) ||
        !ALLOWED_TYPES.has(metadata.contentType || "") ||
        metadata.contentLength < 1 ||
        metadata.contentLength > MAX_AVATAR_BYTES
      ) {
        throw new Error("AVATAR_INVALID");
      }

      const fetched = await objectStorage().getObject(key);
      const chunks: Buffer[] = [];
      for await (const chunk of fetched.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const mimeType = metadata.contentType!;
      const validation = FileSecurity.validateUploadedFile(body, `avatar.${EXTENSIONS[mimeType]}`, mimeType);
      if (!validation.isValid || body.length !== Number(upload.expected_size) || body.length > MAX_AVATAR_BYTES) {
        throw new Error("AVATAR_INVALID");
      }

      const [existing] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1);
      if (!existing) throw new Error("AVATAR_USER_NOT_FOUND");
      const previous = existing.avatarUrl;
      const reference = storageReference(key);
      await db.update(users).set({ avatarUrl: reference, updatedAt: new Date() }).where(eq(users.id, userId));
      await db.execute(sql`DELETE FROM profile_avatar_uploads WHERE id = ${objectId}::uuid AND user_id = ${userId}::uuid`);

      if (previous && this.isStorageReference(previous) && previous !== reference) {
        await objectStorage().deleteObject(this.keyFromReference(previous)).catch(() => undefined);
      }

      return { avatarUrl: await this.resolvePublicUrl(reference) };
    } catch (error) {
      await db.execute(sql`
        UPDATE profile_avatar_uploads SET status = 'FAILED', updated_at = now()
        WHERE id = ${objectId}::uuid AND user_id = ${userId}::uuid
      `).catch(() => undefined);
      throw error;
    }
  }

  static async cleanupExpiredUploads(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number.isFinite(limit) ? Math.floor(limit) : 100));
    const result = await db.execute(sql`
      SELECT id, user_id, storage_key, mime_type, expected_size, status, expires_at
      FROM profile_avatar_uploads
      WHERE status IN ('FAILED', 'EXPIRED')
         OR (status = 'PENDING_UPLOAD' AND expires_at <= now())
      ORDER BY expires_at ASC
      LIMIT ${safeLimit}
    `);
    const rows = rowsOf<AvatarUploadRow>(result);
    let deleted = 0;

    for (const upload of rows) {
      try {
        await objectStorage().deleteObject(upload.storage_key);
        await db.execute(sql`DELETE FROM profile_avatar_uploads WHERE id = ${upload.id}::uuid`);
        deleted += 1;
      } catch {
        metrics.increment("storage_avatar_cleanup_errors_total");
      }
    }

    if (deleted) metrics.increment("storage_avatar_cleanup_total", {}, deleted);
    return deleted;
  }

  static async remove(userId: string) {
    const [existing] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw new Error("AVATAR_USER_NOT_FOUND");
    await db.update(users).set({ avatarUrl: null, updatedAt: new Date() }).where(eq(users.id, userId));
    if (existing.avatarUrl && this.isStorageReference(existing.avatarUrl)) {
      await objectStorage().deleteObject(this.keyFromReference(existing.avatarUrl)).catch(() => undefined);
    }
  }
}
