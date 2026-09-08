export type IngestionInput = {
  knowledgeBaseId: string;
  title: string;
  category?: string;
  language?: string;
} & (
  | { type: "document" | "faq"; content: string }
  | { type: "pdf"; objectId: string; filename: string }
  | { type: "website"; targetUrl: string; maxPages: number; maxDepth: number }
);

export type IngestionReference = { organizationId: string; jobId: string; revision: number; attempt: number };
export const MAX_INGESTION_ATTEMPTS = 3;
export const INGESTION_LEASE_MS = 15 * 60_000;

export function ingestionQueueId(ref: IngestionReference) {
  return `${ref.jobId}-${ref.revision}-${ref.attempt}`;
}

export function canCommitIngestion(job: { revision: number; leaseToken: string | null; status: string } | undefined, revision: number, token: string) {
  return Boolean(job && job.revision === revision && job.leaseToken === token && job.status === "processing");
}
