import pg from "pg";

const lockDatabaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production" && !lockDatabaseUrl) throw new Error("DATABASE_URL is required for scheduling locks");

const configuredLockPoolMax = Number(process.env.DATABASE_SCHEDULING_LOCK_POOL_MAX || 2);
const lockPoolMax = Number.isInteger(configuredLockPoolMax) && configuredLockPoolMax >= 1
  ? Math.min(configuredLockPoolMax, 8)
  : 2;

const lockPool = new pg.Pool({
  connectionString: lockDatabaseUrl || "postgres://postgres:postgrespassword@localhost:5432/ai_support_db",
  max: lockPoolMax,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 5_000),
  allowExitOnIdle: true,
});

/**
 * Serializes booking mutations per organization across all application instances.
 * A dedicated pool prevents lock waiters from consuming normal API query slots.
 */
export class SchedulingMutationLockService {
  static async run<T>(organizationId: string, work: () => Promise<T>): Promise<T> {
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) throw new Error("Invalid organization id");
    const client = await lockPool.connect();
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
