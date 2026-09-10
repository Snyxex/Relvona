import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/security.js";
import { db } from "../db/index.js";
import { conversations, fileAttachments, fileObjects, tickets } from "../db/schema.js";
import { FileObjectService } from "../services/fileObjectService.js";
import { objectStorage } from "../services/objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";
import { AuditService } from "../services/auditService.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent"]));

const attachmentIntentLimit = createRateLimiter({ keyPrefix: "attachment-intent", limit: 60, windowMs: 15 * 60_000 });
const attachmentFinalizeLimit = createRateLimiter({ keyPrefix: "attachment-finalize", limit: 60, windowMs: 15 * 60_000 });
const attachmentDownloadLimit = createRateLimiter({ keyPrefix: "attachment-download", limit: 240, windowMs: 15 * 60_000 });
const attachmentDeleteLimit = createRateLimiter({ keyPrefix: "attachment-delete", limit: 60, windowMs: 15 * 60_000 });

const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const supportsSignedUrls = () => {
  const provider = objectStorageConfig().provider;
  return provider === "s3" || provider === "rustfs";
};

type AttachmentIntentMetadata = {
  maxSize?: number;
  attachmentKind?: "conversation" | "ticket";
  parentType?: "conversation" | "ticket";
  parentId?: string;
  visibility?: "INTERNAL_ONLY" | "CUSTOMER_VISIBLE";
  uploaderUserId?: string;
};

async function parent(org: string, kind: "conversation" | "ticket", id: string) {
  return kind === "conversation"
    ? Boolean((await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, id), eq(conversations.organizationId, org))).limit(1))[0])
    : Boolean((await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.id, id), eq(tickets.organizationId, org))).limit(1))[0]);
}

router.get("/", async (req: AuthRequest, res) => {
  const parentType = req.query.parentType;
  const parentId = req.query.parentId;
  if ((parentType !== "conversation" && parentType !== "ticket") || !validId(parentId)) {
    return res.status(400).json({ error: "ATTACHMENT_PARENT_INVALID" });
  }
  if (!await parent(req.organization!.id, parentType, parentId)) {
    return res.status(404).json({ error: "ATTACHMENT_PARENT_NOT_FOUND" });
  }

  const relation = parentType === "conversation"
    ? eq(fileAttachments.conversationId, parentId)
    : eq(fileAttachments.ticketId, parentId);
  const rows = await db
    .select({
      id: fileAttachments.id,
      originalFilename: fileAttachments.originalFilename,
      mimeType: fileAttachments.mimeType,
      fileSize: fileAttachments.fileSize,
      visibility: fileAttachments.visibility,
      uploaderUserId: fileAttachments.uploaderUserId,
      uploaderType: fileAttachments.uploaderType,
      createdAt: fileAttachments.createdAt,
    })
    .from(fileAttachments)
    .where(and(
      eq(fileAttachments.organizationId, req.organization!.id),
      eq(fileAttachments.status, "READY"),
      relation,
    ))
    .orderBy(desc(fileAttachments.createdAt));

  const isAdmin = req.organization!.role === "owner" || req.organization!.role === "admin";
  return res.json(rows.map((row) => ({
    id: row.id,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    visibility: row.visibility,
    uploaderType: row.uploaderType,
    createdAt: row.createdAt,
    canDelete: isAdmin || row.uploaderUserId === req.user!.id,
  })));
});

router.post("/intent", attachmentIntentLimit, async (req: AuthRequest, res) => {
  try {
    const { parentType, parentId, originalFilename, mimeType, maxSize, visibility = "INTERNAL_ONLY" } = req.body || {};
    if (
      (parentType !== "conversation" && parentType !== "ticket") ||
      !validId(parentId) ||
      typeof originalFilename !== "string" ||
      originalFilename.length < 1 ||
      originalFilename.length > 255 ||
      typeof mimeType !== "string" ||
      !Number.isInteger(maxSize) ||
      maxSize < 1 ||
      maxSize > 10 * 1024 * 1024 ||
      !["INTERNAL_ONLY", "CUSTOMER_VISIBLE"].includes(visibility) ||
      !await parent(req.organization!.id, parentType, parentId)
    ) {
      return res.status(400).json({ error: "UPLOAD_INVALID" });
    }

    const intent = await FileObjectService.createAttachmentUploadIntent({
      organizationId: req.organization!.id,
      originalFilename,
      mimeType,
      maxSize,
      attachmentKind: parentType,
    });

    const immutableMetadata: AttachmentIntentMetadata = {
      ...((intent.object.metadata || {}) as AttachmentIntentMetadata),
      parentType,
      parentId,
      visibility,
      uploaderUserId: req.user!.id,
    };
    await db
      .update(fileObjects)
      .set({ metadata: immutableMetadata, updatedAt: new Date() })
      .where(and(eq(fileObjects.id, intent.object.id), eq(fileObjects.organizationId, req.organization!.id)));

    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "attachment.upload_intent",
      resourceType: "file_object",
      resourceId: intent.object.id,
      metadata: { parentType, parentId, visibility },
    });
    return res.status(201).json({
      objectId: intent.object.id,
      uploadUrl: intent.uploadUrl,
      expiresInSeconds: objectStorageConfig().signedUrlTtlSeconds,
    });
  } catch {
    return res.status(503).json({ error: "STORAGE_UNAVAILABLE" });
  }
});

router.post("/:objectId/finalize", attachmentFinalizeLimit, async (req: AuthRequest, res) => {
  try {
    const { parentType, parentId, visibility = "INTERNAL_ONLY" } = req.body || {};
    if (
      (parentType !== "conversation" && parentType !== "ticket") ||
      !validId(parentId) ||
      !["INTERNAL_ONLY", "CUSTOMER_VISIBLE"].includes(visibility) ||
      !validId(req.params.objectId) ||
      !await parent(req.organization!.id, parentType, parentId)
    ) {
      return res.status(400).json({ error: "UPLOAD_INVALID" });
    }

    const [pendingObject] = await db
      .select({ metadata: fileObjects.metadata })
      .from(fileObjects)
      .where(and(eq(fileObjects.id, req.params.objectId), eq(fileObjects.organizationId, req.organization!.id)))
      .limit(1);
    const bound = pendingObject?.metadata as AttachmentIntentMetadata | null | undefined;
    if (
      !bound ||
      bound.parentType !== parentType ||
      bound.parentId !== parentId ||
      bound.visibility !== visibility ||
      bound.uploaderUserId !== req.user!.id
    ) {
      return res.status(400).json({ error: "UPLOAD_BINDING_MISMATCH" });
    }

    const result = await FileObjectService.finalizeAttachmentUpload(req.organization!.id, req.params.objectId);
    const [created] = await db
      .insert(fileAttachments)
      .values({
        organizationId: req.organization!.id,
        fileObjectId: result.object.id,
        conversationId: parentType === "conversation" ? parentId : null,
        ticketId: parentType === "ticket" ? parentId : null,
        uploaderUserId: req.user!.id,
        uploaderType: "AGENT",
        visibility,
        originalFilename: result.object.originalFilename,
        mimeType: result.object.mimeType,
        fileSize: result.object.fileSize,
        status: "READY",
      })
      .onConflictDoNothing()
      .returning();
    const attachment = created || (
      await db
        .select()
        .from(fileAttachments)
        .where(and(eq(fileAttachments.fileObjectId, result.object.id), eq(fileAttachments.organizationId, req.organization!.id)))
        .limit(1)
    )[0];
    if (!attachment) throw new Error("UPLOAD_INVALID");

    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "attachment.created",
      resourceType: "attachment",
      resourceId: attachment.id,
      metadata: { parentType, parentId, visibility },
    });
    return res.status(created ? 201 : 200).json(attachment);
  } catch (error) {
    const code = (error as Error).message;
    return res.status(code === "ATTACHMENT_NOT_READY" ? 409 : 400).json({
      error: code === "FILE_REJECTED" ? "FILE_REJECTED" : "UPLOAD_INVALID",
    });
  }
});

router.get("/:id/download", attachmentDownloadLimit, async (req: AuthRequest, res) => {
  try {
    const [attachment] = await db
      .select()
      .from(fileAttachments)
      .where(
        and(
          eq(fileAttachments.id, req.params.id),
          eq(fileAttachments.organizationId, req.organization!.id),
          eq(fileAttachments.status, "READY"),
        ),
      )
      .limit(1);
    if (!attachment) return res.status(404).json({ error: "ATTACHMENT_NOT_FOUND" });

    const file = await FileObjectService.readForOrganization(req.organization!.id, attachment.fileObjectId);
    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "attachment.downloaded",
      resourceType: "attachment",
      resourceId: attachment.id,
    });

    if (supportsSignedUrls()) {
      return res.json({
        downloadUrl: await objectStorage().createSignedDownloadUrl(
          file.object.storageKey,
          objectStorageConfig().signedUrlTtlSeconds,
        ),
      });
    }

    res.type(file.object.mimeType).attachment(file.object.originalFilename);
    file.body.pipe(res);
  } catch {
    return res.status(404).json({ error: "ATTACHMENT_NOT_FOUND" });
  }
});

router.delete("/:id", attachmentDeleteLimit, async (req: AuthRequest, res) => {
  try {
    const [attachment] = await db
      .select()
      .from(fileAttachments)
      .where(and(
        eq(fileAttachments.id, req.params.id),
        eq(fileAttachments.organizationId, req.organization!.id),
        eq(fileAttachments.status, "READY"),
      ))
      .limit(1);
    if (!attachment) return res.status(404).json({ error: "ATTACHMENT_NOT_FOUND" });

    const isAdmin = req.organization!.role === "owner" || req.organization!.role === "admin";
    if (!isAdmin && attachment.uploaderUserId !== req.user!.id) {
      return res.status(403).json({ error: "ATTACHMENT_DELETE_FORBIDDEN" });
    }

    const deleted = await FileObjectService.deleteForOrganization(req.organization!.id, attachment.fileObjectId);
    if (!deleted) return res.status(503).json({ error: "ATTACHMENT_DELETE_PENDING" });

    await db
      .update(fileAttachments)
      .set({ status: "DELETED", deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(fileAttachments.id, attachment.id), eq(fileAttachments.organizationId, req.organization!.id)));

    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "attachment.deleted",
      resourceType: "attachment",
      resourceId: attachment.id,
      metadata: {
        parentType: attachment.conversationId ? "conversation" : "ticket",
        parentId: attachment.conversationId || attachment.ticketId,
        visibility: attachment.visibility,
      },
    });
    return res.status(204).end();
  } catch {
    return res.status(500).json({ error: "ATTACHMENT_DELETE_FAILED" });
  }
});

export default router;
