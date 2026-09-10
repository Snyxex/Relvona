import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { objectStorage } from "./objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";
import { FileSecurity } from "./fileSecurity.js";

const MAX_AVATAR_BYTES = 1024 * 1024;
const STORAGE_PREFIX = "storage://";
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
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
    const uploadUrl = await objectStorage().createSignedUploadUrl(
      key,
      objectStorageConfig().signedUrlTtlSeconds,
      { contentType: mimeType, contentLength: size },
    );
    return { objectId, uploadUrl, expiresInSeconds: objectStorageConfig().signedUrlTtlSeconds };
  }

  static async finalize(userId: string, objectId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(objectId)) throw new Error("AVATAR_INVALID");
    const key = avatarKey(userId, objectId);
    const metadata = await objectStorage().getObjectMetadata(key);
    if (!ALLOWED_TYPES.has(metadata.contentType || "") || metadata.contentLength < 1 || metadata.contentLength > MAX_AVATAR_BYTES) {
      await objectStorage().deleteObject(key).catch(() => undefined);
      throw new Error("AVATAR_INVALID");
    }

    const fetched = await objectStorage().getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of fetched.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const mimeType = metadata.contentType!;
    const validation = FileSecurity.validateUploadedFile(body, `avatar.${EXTENSIONS[mimeType]}`, mimeType);
    if (!validation.isValid || body.length > MAX_AVATAR_BYTES) {
      await objectStorage().deleteObject(key).catch(() => undefined);
      throw new Error("AVATAR_INVALID");
    }

    const [existing] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw new Error("AVATAR_USER_NOT_FOUND");
    const previous = existing.avatarUrl;
    const reference = storageReference(key);
    await db.update(users).set({ avatarUrl: reference, updatedAt: new Date() }).where(eq(users.id, userId));

    if (previous && this.isStorageReference(previous) && previous !== reference) {
      await objectStorage().deleteObject(this.keyFromReference(previous)).catch(() => undefined);
    }

    return { avatarUrl: await this.resolvePublicUrl(reference) };
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
