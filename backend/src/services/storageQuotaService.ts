import { sql } from "drizzle-orm";

const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB

type QueryExecutor = {
  execute: (...args: any[]) => Promise<any>;
};

type UsageRow = {
  active_bytes: string | number | bigint | null;
  reserved_bytes: string | number | bigint | null;
};

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function quotaBytes() {
  const raw = process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES;
  if (raw === undefined || raw === "") return DEFAULT_QUOTA_BYTES;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("OBJECT_STORAGE_TENANT_QUOTA_BYTES must be a non-negative safe integer");
  }
  return value;
}

async function usage(executor: QueryExecutor, organizationId: string) {
  const result = await executor.execute(sql`
    SELECT
      COALESCE(SUM(
        CASE WHEN status IN ('UPLOADED', 'READY') THEN file_size::bigint ELSE 0 END
      ), 0)::bigint AS active_bytes,
      COALESCE(SUM(
        CASE
          WHEN status IN ('PENDING_UPLOAD', 'PROCESSING') THEN
            CASE
              WHEN metadata->>'maxSize' ~ '^[0-9]+$' THEN (metadata->>'maxSize')::bigint
              ELSE GREATEST(file_size, 0)::bigint
            END
          ELSE 0
        END
      ), 0)::bigint AS reserved_bytes
    FROM file_objects
    WHERE organization_id = ${organizationId}::uuid
      AND status IN ('PENDING_UPLOAD', 'PROCESSING', 'UPLOADED', 'READY')
  `);
  const row = rowsOf<UsageRow>(result)[0];
  return {
    activeBytes: Number(row?.active_bytes ?? 0),
    reservedBytes: Number(row?.reserved_bytes ?? 0),
  };
}

export class StorageQuotaService {
  static quotaBytes() {
    return quotaBytes();
  }

  static async getUsage(executor: QueryExecutor, organizationId: string) {
    const current = await usage(executor, organizationId);
    const quota = quotaBytes();
    const used = current.activeBytes + current.reservedBytes;
    return {
      quotaBytes: quota,
      activeBytes: current.activeBytes,
      reservedBytes: current.reservedBytes,
      usedBytes: used,
      availableBytes: quota === 0 ? null : Math.max(0, quota - used),
      unlimited: quota === 0,
    };
  }

  static async assertCanReserve(executor: QueryExecutor, organizationId: string, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error("STORAGE_RESERVATION_INVALID");
    const quota = quotaBytes();
    if (quota === 0) return;

    // Serialize quota reservations per organization inside the caller's transaction.
    await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`storage-quota:${organizationId}`}, 0))`);
    const current = await usage(executor, organizationId);
    if (current.activeBytes + current.reservedBytes + bytes > quota) {
      throw new Error("STORAGE_QUOTA_EXCEEDED");
    }
  }
}
