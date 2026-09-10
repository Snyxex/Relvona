import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import dotenv from "dotenv";
import { currentDatabaseContext, currentDatabaseTenant, type RequestDatabaseClient } from "./tenantContext.js";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production" && !databaseUrl) {
  throw new Error("DATABASE_URL must be injected in production");
}

function envInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

const connectionString = databaseUrl || "postgres://postgres:postgrespassword@localhost:5432/ai_support_db";
const commonPoolOptions = {
  connectionString,
  idleTimeoutMillis: envInteger("DATABASE_IDLE_TIMEOUT_MS", 30_000, 1_000, 300_000),
  connectionTimeoutMillis: envInteger("DATABASE_CONNECTION_TIMEOUT_MS", 5_000, 500, 60_000),
  maxLifetimeSeconds: envInteger("DATABASE_MAX_LIFETIME_SECONDS", 1_800, 60, 86_400),
};

/** Core pool for workers, explicit transactions and non-request workloads. */
export const pool = new pg.Pool({
  ...commonPoolOptions,
  max: envInteger("DATABASE_POOL_MAX", 10, 1, 200),
  min: envInteger("DATABASE_POOL_MIN", 0, 0, 50),
});

/** Dedicated pool for HTTP requests so slow external calls cannot starve workers. */
export const requestPool = new pg.Pool({
  ...commonPoolOptions,
  max: envInteger("DATABASE_REQUEST_POOL_MAX", 20, 1, 500),
  min: envInteger("DATABASE_REQUEST_POOL_MIN", 0, 0, 100),
});

pool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "database.core_pool_error", message: error.message })));
requestPool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "database.request_pool_error", message: error.message })));

const corePoolQuery = pool.query.bind(pool);

async function transientTenantQuery(organizationId: string, args: Parameters<typeof pool.query>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await (client.query as any)(...args);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function requestScopedQuery(...args: Parameters<typeof pool.query>) {
  const context = currentDatabaseContext();
  if (!context) return corePoolQuery(...args);

  const organizationId = currentDatabaseTenant();
  if (!context.requestScoped) {
    return organizationId ? transientTenantQuery(organizationId, args) : corePoolQuery(...args);
  }
  if (context.released) throw new Error("Database request context already released");

  if (!context.requestClientPromise) {
    context.requestClientPromise = requestPool.connect() as Promise<RequestDatabaseClient>;
  }
  const client = await context.requestClientPromise;
  if (context.released) throw new Error("Database request context already released");
  context.requestClient = client;

  if (organizationId && context.appliedTenantId !== organizationId) {
    if (context.appliedTenantId && context.appliedTenantId !== organizationId) throw new Error("Cross-tenant request rejected");
    await client.query("SELECT set_config('app.organization_id', $1, false)", [organizationId]);
    context.appliedTenantId = organizationId;
  }

  return (client.query as any)(...args);
}

// Drizzle uses pool.query internally. HTTP requests reuse one request-pool client;
// transient tenant contexts retain the safe transaction-local RLS fallback.
pool.query = requestScopedQuery as typeof pool.query;

export const db = drizzle(pool, { schema });

/** All statements share one connection and one transaction-local RLS context. */
export async function withTenantTransaction<T>(organizationId: string, work: (tx: typeof db) => Promise<T>): Promise<T> {
  const activeTenant = currentDatabaseTenant();
  if (activeTenant && activeTenant !== organizationId) throw new Error("Cross-tenant transaction rejected");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await work(drizzle(client, { schema }) as unknown as typeof db);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export function databasePoolStats() {
  return {
    core: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    request: { total: requestPool.totalCount, idle: requestPool.idleCount, waiting: requestPool.waitingCount },
  };
}

export async function closeDatabasePool() {
  await Promise.all([pool.end(), requestPool.end()]);
}
