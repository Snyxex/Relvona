import crypto from "node:crypto";
import { and, eq, gt, lte, or } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { fileObjects } from "../db/schema.js";
import { objectStorage } from "./objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";
import { FileSecurity } from "./fileSecurity.js";
import { metrics } from "../observability/metrics.js";

const DIRECT_UPLOAD_PROVIDERS = new Set(["s3", "rustfs"]);
const PROCESSING_STALE_MS = 15 * 60_000;

export class FileObjectService {
  static async createAttachmentUploadIntent(data: {
    organizationId: string;
    originalFilename: string;
    mimeType: string;
    maxSize: number;
    attachmentKind: "conversation" | "ticket";
  }) {
    if (!DIRECT_UPLOAD_PROVIDERS.has(objectStorageConfig().provider)) throw new Error("STORAGE_UNAVAILABLE");
    if (
      !/\.(pdf|png|jpe?g|webp|txt|csv)$/i.test(data.originalFilename) ||
      !["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "text/csv"].includes(data.mimeType)
    ) {
      throw new Error("UPLOAD_TYPE_NOT_ALLOWED");
    }

    const id = crypto.randomUUID();
    const storageKey = `organizations/${data.organizationId}/attachments/${data.attachmentKind}/${id}/original-file`;
    const object = await withTenantTransaction(data.organizationId, async (tx) =>
      (
        await tx
          .insert(fileObjects)
          .values({
            id,
            organizationId: data.organizationId,
            storageKey,
            storageClass: "ATTACHMENT",
            originalFilename: data.originalFilename,
            mimeType: data.mimeType,
            fileSize: 0,
            sha256: "pending",
            status: "PENDING_UPLOAD",
            expiresAt: new Date(Date.now() + objectStorageConfig().signedUrlTtlSeconds * 1_000),
            metadata: { maxSize: data.maxSize, attachmentKind: data.attachmentKind },
          })
          .returning()
      )[0],
    );

    try {
      return {
        object,
        uploadUrl: await objectStorage().createSignedUploadUrl(
          storageKey,
          objectStorageConfig().signedUrlTtlSeconds,
          { contentType: data.mimeType, contentLength: data.maxSize },
        ),
      };
    } catch (error) {
      await withTenantTransaction(data.organizationId, (tx) =>
        tx.update(fileObjects).set({ status: "FAILED", updatedAt: new Date() }).where(eq(fileObjects.id, id)),
      );
      throw error;
    }
  }

  static async finalizeAttachmentUpload(organizationId: string, objectId: string) {
    const now = new Date();
    const [object] = await withTenantTransaction(organizationId, (tx) =>
      tx
        .update(fileObjects)
        .set({ status: "PROCESSING", updatedAt: now })
        .where(
          and(
            eq(fileObjects.id, objectId),
            eq(fileObjects.organizationId, organizationId),
            eq(fileObjects.status, "PENDING_UPLOAD"),
            gt(fileObjects.expiresAt, now),
          ),
        )
        .returning(),
    );

    if (!object) {
      const [existing] = await withTenantTransaction(organizationId, (tx) =>
        tx
          .select()
          .from(fileObjects)
          .where(and(eq(fileObjects.id, objectId), eq(fileObjects.organizationId, organizationId)))
          .limit(1),
      );
      if (existing?.status === "READY") {
        return { object: existing, securityStatus: "SAFE" as const, alreadyFinalized: true };
      }
      throw new Error("ATTACHMENT_NOT_READY");
    }

    try {
      const metadata = await objectStorage().getObjectMetadata(object.storageKey);
      const expected = object.metadata as { maxSize: number };
      if (
        metadata.contentLength <= 0 ||
        metadata.contentLength > expected.maxSize ||
        metadata.contentType !== object.mimeType
      ) {
        throw new Error("UPLOAD_INVALID");
      }

      const read = await objectStorage().getObject(object.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of read.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const validation = FileSecurity.validateUploadedFile(body, object.originalFilename, object.mimeType);
      if (!validation.isValid) throw new Error("FILE_REJECTED");

      const sha256 = crypto.createHash("sha256").update(body).digest("hex");
      const [ready] = await withTenantTransaction(organizationId, (tx) =>
        tx
          .update(fileObjects)
          .set({
            status: "READY",
            fileSize: body.length,
            sha256,
            checksumVerifiedAt: new Date(),
            expiresAt: null,
            updatedAt: new Date(),
          })
          .where(and(eq(fileObjects.id, objectId), eq(fileObjects.organizationId, organizationId)))
          .returning(),
      );
      return { object: ready, securityStatus: validation.securityStatus };
    } catch (error) {
      await withTenantTransaction(organizationId, (tx) =>
        tx
          .update(fileObjects)
          .set({ status: "FAILED", updatedAt: new Date() })
          .where(and(eq(fileObjects.id, objectId), eq(fileObjects.organizationId, organizationId))),
      );
      throw error;
    }
  }

  static async createKnowledgeUploadIntent(data: {
    organizationId: string;
    knowledgeBaseId: string;
    title: string;
    originalFilename: string;
    mimeType: string;
    maxSize: number;
  }) {
    if (!DIRECT_UPLOAD_PROVIDERS.has(objectStorageConfig().provider)) throw new Error("Direct upload unavailable");

    const id = crypto.randomUUID();
    const storageKey = `organizations/${data.organizationId}/knowledge/uploads/${id}/raw/original-file`;
    const object = await withTenantTransaction(data.organizationId, async (tx) =>
      (
        await tx
          .insert(fileObjects)
          .values({
            id,
            organizationId: data.organizationId,
            storageKey,
            storageClass: "RAW",
            originalFilename: data.originalFilename,
            mimeType: data.mimeType,
            fileSize: 0,
            sha256: "pending",
            status: "PENDING_UPLOAD",
            expiresAt: new Date(Date.now() + objectStorageConfig().signedUrlTtlSeconds * 1_000),
            metadata: { knowledgeBaseId: data.knowledgeBaseId, title: data.title, maxSize: data.maxSize },
          })
          .returning()
      )[0],
    );

    try {
      return {
        object,
        uploadUrl: await objectStorage().createSignedUploadUrl(
          storageKey,
          objectStorageConfig().signedUrlTtlSeconds,
          { contentType: data.mimeType, contentLength: data.maxSize },
        ),
      };
    } catch (error) {
      await withTenantTransaction(data.organizationId, (tx) =>
        tx.update(fileObjects).set({ status: "FAILED", updatedAt: new Date() }).where(eq(fileObjects.id, id)),
      );
      throw error;
    }
  }

  static async finalizeKnowledgeUpload(organizationId: string, objectId: string) {
    const now = new Date();
    const [object] = await withTenantTransaction(organizationId, (tx) =>
      tx
        .update(fileObjects)
        .set({ status: "PROCESSING", updatedAt: now })
        .where(
          and(
            eq(fileObjects.id, objectId),
            eq(fileObjects.organizationId, organizationId),
            eq(fileObjects.status, "PENDING_UPLOAD"),
            gt(fileObjects.expiresAt, now),
          ),
        )
        .returning(),
    );

    if (!object) {
      const [existing] = await withTenantTransaction(organizationId, (tx) =>
        tx
          .select()
          .from(fileObjects)
          .where(and(eq(fileObjects.id, objectId), eq(fileObjects.organizationId, organizationId)))
          .limit(1),
      );
      if (!existing) throw new Error("FILE_NOT_FOUND");
      if (existing.status === "UPLOADED") return { object: existing, alreadyFinalized: true };
      if (existing.status === "PENDING_UPLOAD" && existing.expiresAt && existing.expiresAt <= now) {
        await withTenantTransaction(organizationId, (tx) =>
          tx
            .update(fileObjects)
            .set({ status: "EXPIRED", updatedAt: now })
            .where(
              and(
                eq(fileObjects.id, objectId),
                eq(fileObjects.organizationId, organizationId),
                eq(fileObjects.status, "PENDING_UPLOAD"),
              ),
            ),
        );
        throw new Error("UPLOAD_EXPIRED");
      }
      throw new Error(existing.status === "PENDING_UPLOAD" ? "UPLOAD_NOT_READY" : "UPLOAD_INVALID");
    }

    try {
      const metadata = await objectStorage().getObjectMetadata(object.storageKey);
      const expected = object.metadata as { maxSize: number };
      if (
        metadata.contentLength <= 0 ||
        metadata.contentLength > expected.maxSize ||
        metadata.contentType !== object.mimeType
      ) {
        throw new Error("UPLOAD_INVALID");
      }

      const fetched = await objectStorage().getObject(object.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of fetched.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const validation = FileSecurity.validateUploadedFile(body, object.originalFilename, object.mimeType);
      if (!validation.isValid) throw new Error("UPLOAD_INVALID");

      const sha256 = crypto.createHash("sha256").update(body).digest("hex");
      const [uploaded] = await withTenantTransaction(organizationId, (tx) =>
        tx
          .update(fileObjects)
          .set({
            status: "UPLOADED",
            fileSize: body.length,
            sha256,
            checksumVerifiedAt: new Date(),
            expiresAt: null,
            updatedAt: new Date(),
          })
          .where(and(eq(fileObjects.id, objectId), eq(fileObjects.organizationId, organizationId)))
          .returning(),
      );
      return { object: uploaded, validation, alreadyFinalized: false };
    } catch (error) {
      await withTenantTransaction(organizationId, (tx) =>
        tx
          .update(fileObjects)
          .set({ status: "FAILED", updatedAt: new Date() })
          .where(and(eq(fileObjects.id, objectId), eq(fileObjects.organizationId, organizationId))),
      );
      throw error;
    }
  }

  static async stageKnowledgeUpload(data: {
    organizationId: string;
    originalFilename: string;
    mimeType: string;
    body: Buffer;
  }) {
    const id = crypto.randomUUID();
    const sha256 = crypto.createHash("sha256").update(data.body).digest("hex");
    const storageKey = `organizations/${data.organizationId}/knowledge/uploads/${id}/raw/original-file`;

    await objectStorage().putObject(storageKey, {
      body: data.body,
      contentLength: data.body.length,
      contentType: data.mimeType,
      sha256,
    });

    try {
      return await withTenantTransaction(data.organizationId, async (tx) => {
        const [object] = await tx
          .insert(fileObjects)
          .values({
            id,
            organizationId: data.organizationId,
            storageKey,
            storageClass: "RAW",
            originalFilename: data.originalFilename,
            mimeType: data.mimeType,
            fileSize: data.body.length,
            sha256,
            status: "UPLOADED",
          })
          .returning();
        return object;
      });
    } catch (error) {
      await objectStorage().deleteObject(storageKey).catch(() => undefined);
      throw error;
    }
  }

  static async readForOrganization(organizationId: string, objectId: string) {
    const [object] = await withTenantTransaction(organizationId, (tx) =>
      tx
        .select()
        .from(fileObjects)
        .where(
          and(
            eq(fileObjects.id, objectId),
            eq(fileObjects.organizationId, organizationId),
            or(eq(fileObjects.status, "UPLOADED"), eq(fileObjects.status, "READY")),
          ),
        )
        .limit(1),
    );
    if (!object) throw new Error("Storage object unavailable");
    const result = await objectStorage().getObject(object.storageKey);
    return { object, body: result.body };
  }

  static async deleteForOrganization(organizationId: string, objectId: string) {
    const [object] = await withTenantTransaction(organizationId, (tx) =>
      tx
        .update(fileObjects)
        .set({ status: "DELETING", updatedAt: new Date() })
        .where(
          and(
            eq(fileObjects.id, objectId),
            eq(fileObjects.organizationId, organizationId),
            or(
              eq(fileObjects.status, "PENDING_UPLOAD"),
              eq(fileObjects.status, "PROCESSING"),
              eq(fileObjects.status, "FAILED"),
              eq(fileObjects.status, "EXPIRED"),
              eq(fileObjects.status, "DELETING"),
              eq(fileObjects.status, "UPLOADED"),
              eq(fileObjects.status, "READY"),
            ),
          ),
        )
        .returning(),
    );
    if (!object) return false;

    try {
      await objectStorage().deleteObject(object.storageKey);
    } catch {
      return false;
    }

    await withTenantTransaction(organizationId, (tx) =>
      tx
        .update(fileObjects)
        .set({ status: "DELETED", deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(fileObjects.id, objectId), eq(fileObjects.organizationId, organizationId))),
    );
    return true;
  }

  static async storeProcessedText(data: {
    organizationId: string;
    sourceId: string;
    revision: number;
    text: string;
  }) {
    const id = crypto.randomUUID();
    const body = Buffer.from(data.text, "utf8");
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    const storageKey = `organizations/${data.organizationId}/knowledge/${data.sourceId}/revisions/${data.revision}/processed/extracted.txt`;

    await objectStorage().putObject(storageKey, {
      body,
      contentType: "text/plain; charset=utf-8",
      contentLength: body.length,
      sha256,
    });

    try {
      return await withTenantTransaction(data.organizationId, async (tx) =>
        (
          await tx
            .insert(fileObjects)
            .values({
              id,
              organizationId: data.organizationId,
              storageKey,
              storageClass: "PROCESSED",
              originalFilename: "extracted.txt",
              mimeType: "text/plain",
              fileSize: body.length,
              sha256,
              status: "READY",
              checksumVerifiedAt: new Date(),
            })
            .returning()
        )[0],
      );
    } catch (error) {
      await objectStorage().deleteObject(storageKey).catch(() => undefined);
      throw error;
    }
  }

  static async cleanupForOrganization(organizationId: string, limit = 50) {
    const now = new Date();
    const staleProcessing = new Date(now.getTime() - PROCESSING_STALE_MS);
    const candidates = await withTenantTransaction(organizationId, (tx) =>
      tx
        .select()
        .from(fileObjects)
        .where(
          and(
            eq(fileObjects.organizationId, organizationId),
            or(
              and(eq(fileObjects.status, "PENDING_UPLOAD"), lte(fileObjects.expiresAt, now)),
              and(eq(fileObjects.status, "PROCESSING"), lte(fileObjects.updatedAt, staleProcessing)),
              eq(fileObjects.status, "FAILED"),
              eq(fileObjects.status, "DELETING"),
              eq(fileObjects.status, "EXPIRED"),
            ),
          ),
        )
        .limit(limit),
    );

    let deleted = 0;
    for (const object of candidates) {
      try {
        if (await this.deleteForOrganization(organizationId, object.id)) deleted += 1;
        else metrics.increment("storage_cleanup_errors_total");
      } catch {
        metrics.increment("storage_cleanup_errors_total");
      }
    }
    if (deleted) metrics.increment("storage_cleanup_total", {}, deleted);
    return deleted;
  }
}
