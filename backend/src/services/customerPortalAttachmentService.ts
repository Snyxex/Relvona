import { and, desc, eq } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { fileAttachments, fileObjects, tickets } from "../db/schema.js";
import type { CustomerPortalSessionContext } from "./customerPortalService.js";
import { objectStorage } from "./objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";

export class CustomerPortalAttachmentService {
  static async listTicketAttachments(session: CustomerPortalSessionContext, ticketId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(ticketId)) throw new Error("Ticket not found");

    return withTenantTransaction(session.organizationId, async (tx) => {
      const [ticket] = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(
          eq(tickets.id, ticketId),
          eq(tickets.organizationId, session.organizationId),
          eq(tickets.customerId, session.customerId),
        ))
        .limit(1);
      if (!ticket) throw new Error("Ticket not found");

      return tx
        .select({
          id: fileAttachments.id,
          originalFilename: fileAttachments.originalFilename,
          mimeType: fileAttachments.mimeType,
          fileSize: fileAttachments.fileSize,
          createdAt: fileAttachments.createdAt,
        })
        .from(fileAttachments)
        .where(and(
          eq(fileAttachments.organizationId, session.organizationId),
          eq(fileAttachments.ticketId, ticketId),
          eq(fileAttachments.visibility, "CUSTOMER_VISIBLE"),
          eq(fileAttachments.status, "READY"),
        ))
        .orderBy(desc(fileAttachments.createdAt));
    });
  }

  static async ticketAttachmentDownloadUrl(
    session: CustomerPortalSessionContext,
    ticketId: string,
    attachmentId: string,
  ) {
    if (!/^[0-9a-f-]{36}$/i.test(ticketId) || !/^[0-9a-f-]{36}$/i.test(attachmentId)) {
      throw new Error("Attachment not found");
    }

    const object = await withTenantTransaction(session.organizationId, async (tx) => {
      const [row] = await tx
        .select({
          storageKey: fileObjects.storageKey,
          mimeType: fileAttachments.mimeType,
          originalFilename: fileAttachments.originalFilename,
        })
        .from(fileAttachments)
        .innerJoin(fileObjects, and(
          eq(fileObjects.id, fileAttachments.fileObjectId),
          eq(fileObjects.organizationId, session.organizationId),
        ))
        .innerJoin(tickets, and(
          eq(tickets.id, fileAttachments.ticketId),
          eq(tickets.organizationId, session.organizationId),
        ))
        .where(and(
          eq(fileAttachments.id, attachmentId),
          eq(fileAttachments.organizationId, session.organizationId),
          eq(fileAttachments.ticketId, ticketId),
          eq(fileAttachments.visibility, "CUSTOMER_VISIBLE"),
          eq(fileAttachments.status, "READY"),
          eq(fileObjects.status, "READY"),
          eq(tickets.customerId, session.customerId),
        ))
        .limit(1);
      return row;
    });

    if (!object) throw new Error("Attachment not found");
    const config = objectStorageConfig();
    if (config.provider !== "s3" && config.provider !== "rustfs") {
      throw new Error("Direct download unavailable");
    }

    return {
      downloadUrl: await objectStorage().createSignedDownloadUrl(
        object.storageKey,
        config.signedUrlTtlSeconds,
      ),
      expiresInSeconds: config.signedUrlTtlSeconds,
      mimeType: object.mimeType,
      originalFilename: object.originalFilename,
    };
  }
}
