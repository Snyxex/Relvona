import Redis from "ioredis";
import { pool } from "../db/index.js";

const redisUrl = process.env.REDIS_URL;
const healthRedis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null }) : null;

export async function readiness() {
  const checks: Record<string, "ok" | "failed"> = {};
  try { await pool.query("SELECT 1"); checks.database = "ok"; } catch { checks.database = "failed"; }
  if (!healthRedis) checks.redis = "failed";
  else {
    try { if (healthRedis.status === "wait") await healthRedis.connect(); await healthRedis.ping(); checks.redis = "ok"; } catch { checks.redis = "failed"; }
  }
  return { ready: Object.values(checks).every((check) => check === "ok"), checks };
}
