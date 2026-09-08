import { pool } from "../db/index.js";

/**
 * Serializes booking mutations per organization across all application instances.
 * The dedicated PostgreSQL session keeps the advisory lock alive while the
 * callback performs its normal tenant-scoped database/provider work.
 */
export class SchedulingMutationLockService {
  static async run<T>(organizationId: string, work: () => Promise<T>): Promise<T> {
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) throw new Error("Invalid organization id");
    const client = await pool.connect();
    const key = `supportai:scheduling:${organizationId}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => undefined);
      client.release();
    }
  }
}
