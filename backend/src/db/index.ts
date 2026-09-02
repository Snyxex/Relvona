import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import dotenv from "dotenv";
import { currentDatabaseTenant } from "./tenantContext.js";

dotenv.config();

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgrespassword@localhost:5432/ai_support_db",
});

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
