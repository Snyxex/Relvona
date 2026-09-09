import { and, desc, eq } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { fileObjects, knowledgeSourceRevisions, knowledgeSources } from "../db/schema.js";

export class KnowledgeRevisionService {
  static async list(organizationId: string, sourceId: string, limitInput?: unknown) {
    const parsed = Number(limitInput ?? 50);
    const limit = Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 50;
    return withTenantTransaction(organizationId, async (tx) => {
      const [source] = await tx.select({ id: knowledgeSources.id, currentRevision: knowledgeSources.currentRevision })
        .from(knowledgeSources)
        .where(and(eq(knowledgeSources.organizationId, organizationId), eq(knowledgeSources.id, sourceId)))
        .limit(1);
      if (!source) throw new Error("Knowledge source not found");

      const rows = await tx.select({
        id: knowledgeSourceRevisions.id,
        revision: knowledgeSourceRevisions.revision,
        rawObjectId: knowledgeSourceRevisions.rawObjectId,
        processedTextObjectId: knowledgeSourceRevisions.processedTextObjectId,
        sha256: knowledgeSourceRevisions.sha256,
        processingStatus: knowledgeSourceRevisions.processingStatus,
        securityStatus: knowledgeSourceRevisions.securityStatus,
        createdAt: knowledgeSourceRevisions.createdAt,
        updatedAt: knowledgeSourceRevisions.updatedAt,
        processedSize: fileObjects.fileSize,
      })
        .from(knowledgeSourceRevisions)
        .leftJoin(fileObjects, and(
          eq(fileObjects.id, knowledgeSourceRevisions.processedTextObjectId),
          eq(fileObjects.organizationId, organizationId),
        ))
        .where(and(eq(knowledgeSourceRevisions.organizationId, organizationId), eq(knowledgeSourceRevisions.sourceId, sourceId)))
        .orderBy(desc(knowledgeSourceRevisions.revision))
        .limit(limit);

      return {
        sourceId,
        currentRevision: source.currentRevision,
        items: rows.map((row) => ({ ...row, active: row.revision === source.currentRevision })),
      };
    });
  }
}
