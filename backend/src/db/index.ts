import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import dotenv from "dotenv";
import { currentDatabaseTenant } from "./tenantContext.js";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production" && !databaseUrl) {
  throw new Error("DATABASE_URL must be injected in production");
}

export const pool = new pg.Pool({
  connectionString: databaseUrl || "postgres://postgres:postgrespassword@localhost:5432/ai_support_db",
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  min: Number(process.env.DATABASE_POOL_MIN || 0),
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 5_000),
  maxLifetimeSeconds: Number(process.env.DATABASE_MAX_LIFETIME_SECONDS || 1_800),
});

pool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "database.pool_error", message: error.message })));

// RLS policies read this transaction-local setting. Leasing a client makes the
// setting and the following query inseparable even when the pool is shared.
const poolQuery = pool.query.bind(pool);
pool.query = (async (...args: Parameters<typeof pool.query>) => {
  const organizationId = currentDatabaseTenant();
  if (!organizationId) return poolQuery(...args);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await client.query(...args);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}) as typeof pool.query;

export const db = drizzle(pool, { schema });

/** All statements share one connection and one transaction-local RLS context. */
export async function withTenantTransaction<T>(organizationId: string, work: (tx: typeof db) => Promise<T>): Promise<T> {
  const activeTenant = currentDatabaseTenant();
  if (activeTenant && activeTenant !== organizationId) throw new Error("Cross-tenant transaction rejected");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await work(drizzle(client, { schema }) as typeof db);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function closeDatabasePool() { await pool.end(); }
