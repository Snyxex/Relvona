import { sql, type SQLWrapper } from "drizzle-orm";

/**
 * Applies assistant collection scope before retrieval ranking.
 * Zero assistant assignments intentionally preserve the legacy unrestricted mode.
 */
export function assistantKnowledgeScopePredicate(
  organizationId: string,
  assistantId: string,
  sourceIdColumn: SQLWrapper,
) {
  return sql<boolean>`(
    NOT EXISTS (
      SELECT 1
      FROM assistant_knowledge_collections akc
      WHERE akc.organization_id = ${organizationId}::uuid
        AND akc.assistant_id = ${assistantId}::uuid
    )
    OR EXISTS (
      SELECT 1
      FROM source_knowledge_collections skc
      INNER JOIN assistant_knowledge_collections akc
        ON akc.organization_id = skc.organization_id
       AND akc.collection_id = skc.collection_id
      WHERE skc.organization_id = ${organizationId}::uuid
        AND skc.source_id = ${sourceIdColumn}
        AND akc.assistant_id = ${assistantId}::uuid
    )
  )`;
}
