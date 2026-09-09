import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { assistants, knowledgeSources } from "../db/schema.js";
import { assistantKnowledgeCollections, knowledgeCollections, sourceKnowledgeCollections } from "../db/knowledgeCollectionsSchema.js";

function normalizeName(value: unknown) {
  if (typeof value !== "string") throw new Error("Collection name is required");
  const name = value.trim();
  if (!name || name.length > 120) throw new Error("Collection name must contain 1–120 characters");
  return name;
}

function normalizeDescription(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) throw new Error("Collection description is invalid");
  return value.trim() || null;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("collectionIds must be an array with at most 100 entries");
  return [...new Set(value.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))];
}

export class KnowledgeCollectionService {
  static async list(organizationId: string) {
    return withTenantTransaction(organizationId, async (tx) => {
      const collections = await tx.select().from(knowledgeCollections)
        .where(eq(knowledgeCollections.organizationId, organizationId))
        .orderBy(asc(knowledgeCollections.name));
      const sourceLinks = await tx.select({ collectionId: sourceKnowledgeCollections.collectionId, sourceId: sourceKnowledgeCollections.sourceId })
        .from(sourceKnowledgeCollections).where(eq(sourceKnowledgeCollections.organizationId, organizationId));
      const assistantLinks = await tx.select({ collectionId: assistantKnowledgeCollections.collectionId, assistantId: assistantKnowledgeCollections.assistantId })
        .from(assistantKnowledgeCollections).where(eq(assistantKnowledgeCollections.organizationId, organizationId));
      return collections.map((collection) => ({
        ...collection,
        sourceCount: sourceLinks.filter((link) => link.collectionId === collection.id).length,
        assistantCount: assistantLinks.filter((link) => link.collectionId === collection.id).length,
      }));
    });
  }

  static async create(organizationId: string, input: Record<string, unknown>) {
    const name = normalizeName(input.name);
    const description = normalizeDescription(input.description);
    return withTenantTransaction(organizationId, async (tx) => {
      const [created] = await tx.insert(knowledgeCollections).values({ organizationId, name, description }).returning();
      return created;
    });
  }

  static async update(organizationId: string, collectionId: string, input: Record<string, unknown>) {
    const patch: { name?: string; description?: string | null; updatedAt: Date } = { updatedAt: new Date() };
    if (Object.prototype.hasOwnProperty.call(input, "name")) patch.name = normalizeName(input.name);
    if (Object.prototype.hasOwnProperty.call(input, "description")) patch.description = normalizeDescription(input.description);
    return withTenantTransaction(organizationId, async (tx) => {
      const [updated] = await tx.update(knowledgeCollections).set(patch)
        .where(and(eq(knowledgeCollections.organizationId, organizationId), eq(knowledgeCollections.id, collectionId))).returning();
      if (!updated) throw new Error("Knowledge collection not found");
      return updated;
    });
  }

  static async remove(organizationId: string, collectionId: string) {
    return withTenantTransaction(organizationId, async (tx) => {
      const [deleted] = await tx.delete(knowledgeCollections)
        .where(and(eq(knowledgeCollections.organizationId, organizationId), eq(knowledgeCollections.id, collectionId))).returning({ id: knowledgeCollections.id });
      if (!deleted) throw new Error("Knowledge collection not found");
      return deleted;
    });
  }

  static async setSourceCollections(organizationId: string, sourceId: string, collectionIdsInput: unknown) {
    const collectionIds = normalizeIds(collectionIdsInput);
    return withTenantTransaction(organizationId, async (tx) => {
      const [source] = await tx.select({ id: knowledgeSources.id }).from(knowledgeSources)
        .where(and(eq(knowledgeSources.organizationId, organizationId), eq(knowledgeSources.id, sourceId))).limit(1);
      if (!source) throw new Error("Knowledge source not found");
      if (collectionIds.length) {
        const valid = await tx.select({ id: knowledgeCollections.id }).from(knowledgeCollections)
          .where(and(eq(knowledgeCollections.organizationId, organizationId), inArray(knowledgeCollections.id, collectionIds)));
        if (valid.length !== collectionIds.length) throw new Error("One or more knowledge collections were not found");
      }
      await tx.delete(sourceKnowledgeCollections).where(and(eq(sourceKnowledgeCollections.organizationId, organizationId), eq(sourceKnowledgeCollections.sourceId, sourceId)));
      if (collectionIds.length) await tx.insert(sourceKnowledgeCollections).values(collectionIds.map((collectionId) => ({ organizationId, sourceId, collectionId })));
      return { sourceId, collectionIds };
    });
  }

  static async setAssistantCollections(organizationId: string, assistantId: string, collectionIdsInput: unknown) {
    const collectionIds = normalizeIds(collectionIdsInput);
    return withTenantTransaction(organizationId, async (tx) => {
      const [assistant] = await tx.select({ id: assistants.id }).from(assistants)
        .where(and(eq(assistants.organizationId, organizationId), eq(assistants.id, assistantId))).limit(1);
      if (!assistant) throw new Error("Assistant not found");
      if (collectionIds.length) {
        const valid = await tx.select({ id: knowledgeCollections.id }).from(knowledgeCollections)
          .where(and(eq(knowledgeCollections.organizationId, organizationId), inArray(knowledgeCollections.id, collectionIds)));
        if (valid.length !== collectionIds.length) throw new Error("One or more knowledge collections were not found");
      }
      await tx.delete(assistantKnowledgeCollections).where(and(eq(assistantKnowledgeCollections.organizationId, organizationId), eq(assistantKnowledgeCollections.assistantId, assistantId)));
      if (collectionIds.length) await tx.insert(assistantKnowledgeCollections).values(collectionIds.map((collectionId) => ({ organizationId, assistantId, collectionId })));
      return { assistantId, collectionIds, unrestricted: collectionIds.length === 0 };
    });
  }

  static async getAssistantScope(organizationId: string, assistantId: string) {
    return withTenantTransaction(organizationId, async (tx) => {
      const rows = await tx.select({ collectionId: assistantKnowledgeCollections.collectionId, name: knowledgeCollections.name })
        .from(assistantKnowledgeCollections)
        .innerJoin(knowledgeCollections, and(eq(knowledgeCollections.id, assistantKnowledgeCollections.collectionId), eq(knowledgeCollections.organizationId, organizationId)))
        .where(and(eq(assistantKnowledgeCollections.organizationId, organizationId), eq(assistantKnowledgeCollections.assistantId, assistantId)))
        .orderBy(asc(knowledgeCollections.name));
      return { assistantId, unrestricted: rows.length === 0, collections: rows };
    });
  }
}
