export type AttachmentParentType = "conversation" | "ticket";
export type AttachmentVisibility = "INTERNAL_ONLY" | "CUSTOMER_VISIBLE";

export type AttachmentIntentBinding = {
  parentType?: AttachmentParentType;
  parentId?: string;
  visibility?: AttachmentVisibility;
  uploaderUserId?: string;
};

export function matchesAttachmentIntentBinding(
  metadata: unknown,
  expected: {
    parentType: AttachmentParentType;
    parentId: string;
    visibility: AttachmentVisibility;
    uploaderUserId: string;
  },
): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const binding = metadata as AttachmentIntentBinding;
  return (
    binding.parentType === expected.parentType &&
    binding.parentId === expected.parentId &&
    binding.visibility === expected.visibility &&
    binding.uploaderUserId === expected.uploaderUserId
  );
}
