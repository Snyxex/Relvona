import { api } from "./api";

export type AttachmentParentType = "conversation" | "ticket";
export type AttachmentVisibility = "INTERNAL_ONLY" | "CUSTOMER_VISIBLE";

export type AttachmentListItem = {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  visibility: AttachmentVisibility;
  uploaderType: string;
  createdAt: string;
  canDelete: boolean;
};

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
]);
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

export async function uploadAttachment(input: {
  parentType: AttachmentParentType;
  parentId: string;
  file: File;
  visibility?: AttachmentVisibility;
}) {
  if (!ALLOWED_MIME_TYPES.has(input.file.type)) throw new Error("ATTACHMENT_TYPE_NOT_ALLOWED");
  if (input.file.size < 1 || input.file.size > MAX_ATTACHMENT_SIZE) throw new Error("ATTACHMENT_SIZE_INVALID");

  const visibility = input.visibility ?? "INTERNAL_ONLY";
  const intent = await api.post("/attachments/intent", {
    parentType: input.parentType,
    parentId: input.parentId,
    originalFilename: input.file.name,
    mimeType: input.file.type,
    maxSize: input.file.size,
    visibility,
  });
  const objectId = intent.data?.objectId;
  const uploadUrl = intent.data?.uploadUrl;
  if (typeof objectId !== "string" || typeof uploadUrl !== "string") {
    throw new Error("ATTACHMENT_UPLOAD_INTENT_INVALID");
  }

  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    body: input.file,
    headers: { "Content-Type": input.file.type },
  });
  if (!uploaded.ok) throw new Error(`ATTACHMENT_STORAGE_UPLOAD_FAILED_${uploaded.status}`);

  const finalized = await api.post(`/attachments/${objectId}/finalize`, {
    parentType: input.parentType,
    parentId: input.parentId,
    visibility,
  });
  return finalized.data as AttachmentListItem;
}

export async function listAttachments(parentType: AttachmentParentType, parentId: string) {
  const response = await api.get("/attachments", { params: { parentType, parentId } });
  return response.data as AttachmentListItem[];
}

export async function downloadAttachment(attachmentId: string) {
  const response = await api.get(`/attachments/${attachmentId}/download`);
  if (response.data?.downloadUrl) {
    window.location.assign(response.data.downloadUrl);
    return;
  }
  throw new Error("ATTACHMENT_DOWNLOAD_URL_MISSING");
}

export async function deleteAttachment(attachmentId: string) {
  await api.delete(`/attachments/${attachmentId}`);
}

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
