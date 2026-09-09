import { and, eq, isNull, lte, or } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { knowledgeSources } from "../db/schema.js";
import { knowledgeSourceIntelligence } from "../db/supportAnalyticsSchema.js";
import { IngestionJobService } from "./ingestionJobService.js";
import { publishIngestion } from "./queueService.js";

const MAX_RECRAWLS_PER_SWEEP = 25;
const MIN_RETRY_MINUTES = 15;

type ClaimedRecrawl = {
  organizationId: string;
  sourceId: string;
  scheduledAt: Date;
};

function nextCrawlTime(now: Date, intervalMinutes: number) {
  return new Date(now.getTime() + intervalMinutes * 60_000);
}

export class KnowledgeRecrawlService {
  static async claimDueForOrganization(organizationId: string, now = new Date()): Promise<ClaimedRecrawl[]> {
    return withTenantTransaction(organizationId, async (tx) => {
      const candidates = await tx
        .select({
          sourceId: knowledgeSources.id,
          lastCrawledAt: knowledgeSources.lastCrawledAt,
          nextCrawlAt: knowledgeSourceIntelligence.nextCrawlAt,
          intervalMinutes: knowledgeSourceIntelligence.recrawlIntervalMinutes,
          intelligenceId: knowledgeSourceIntelligence.id,
        })
        .from(knowledgeSourceIntelligence)
        .innerJoin(
          knowledgeSources,
          and(eq(knowledgeSources.id, knowledgeSourceIntelligence.sourceId), eq(knowledgeSources.organizationId, organizationId)),
        )
        .where(and(
          eq(knowledgeSourceIntelligence.organizationId, organizationId),
          eq(knowledgeSourceIntelligence.recrawlEnabled, true),
          or(eq(knowledgeSourceIntelligence.publicationStatus, "PUBLISHED"), eq(knowledgeSourceIntelligence.publicationStatus, "DRAFT")),
          eq(knowledgeSources.type, "website"),
          or(eq(knowledgeSources.status, "completed"), eq(knowledgeSources.status, "failed")),
          or(lte(knowledgeSourceIntelligence.nextCrawlAt, now), isNull(knowledgeSourceIntelligence.nextCrawlAt)),
        ))
        .limit(MAX_RECRAWLS_PER_SWEEP);

      const claimed: ClaimedRecrawl[] = [];
      for (const candidate of candidates) {
        const intervalMinutes = candidate.intervalMinutes;
        if (!intervalMinutes || intervalMinutes < 60) continue;

        if (!candidate.nextCrawlAt && candidate.lastCrawledAt) {
          const dueAt = nextCrawlTime(candidate.lastCrawledAt, intervalMinutes);
          if (dueAt.getTime() > now.getTime()) {
            await tx.update(knowledgeSourceIntelligence)
              .set({ nextCrawlAt: dueAt, updatedAt: now })
              .where(and(
                eq(knowledgeSourceIntelligence.id, candidate.intelligenceId),
                eq(knowledgeSourceIntelligence.organizationId, organizationId),
                isNull(knowledgeSourceIntelligence.nextCrawlAt),
              ));
            continue;
          }
        }

        const scheduledAt = nextCrawlTime(now, intervalMinutes);
        const [won] = await tx.update(knowledgeSourceIntelligence)
          .set({ nextCrawlAt: scheduledAt, updatedAt: now })
          .where(and(
            eq(knowledgeSourceIntelligence.id, candidate.intelligenceId),
            eq(knowledgeSourceIntelligence.organizationId, organizationId),
            eq(knowledgeSourceIntelligence.recrawlEnabled, true),
            candidate.nextCrawlAt ? lte(knowledgeSourceIntelligence.nextCrawlAt, now) : isNull(knowledgeSourceIntelligence.nextCrawlAt),
          ))
          .returning({ id: knowledgeSourceIntelligence.id });

        if (won) claimed.push({ organizationId, sourceId: candidate.sourceId, scheduledAt });
      }
      return claimed;
    });
  }

  static async dispatchDueForOrganization(organizationId: string, now = new Date()) {
    const claimed = await this.claimDueForOrganization(organizationId, now);
    let dispatched = 0;
    let failed = 0;

    for (const item of claimed) {
      try {
        const input = await IngestionJobService.inputFor(organizationId, item.sourceId);
        if (input.type !== "website") throw new Error("Recrawl source is not a website");
        const ref = await IngestionJobService.submit(organizationId, input, item.sourceId);
        await publishIngestion(ref).catch(() => undefined);
        dispatched += 1;
      } catch {
        failed += 1;
        const retryAt = new Date(now.getTime() + MIN_RETRY_MINUTES * 60_000);
        await withTenantTransaction(organizationId, async (tx) => {
          await tx.update(knowledgeSourceIntelligence)
            .set({ nextCrawlAt: retryAt, lastFailureAt: now, lastFailureCategory: "SCHEDULING_FAILED", health: "CRAWL_FAILED", updatedAt: now })
            .where(and(eq(knowledgeSourceIntelligence.organizationId, organizationId), eq(knowledgeSourceIntelligence.sourceId, item.sourceId)));
        });
      }
    }

    return { claimed: claimed.length, dispatched, failed };
  }
}
