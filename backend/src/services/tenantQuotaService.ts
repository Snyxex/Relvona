import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null }) : null;

export class TenantQuotaExceededError extends Error {
  constructor(public readonly retryAfterSeconds: number, message = "Daily tenant token budget exhausted") { super(message); }
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

function dayKey() { return new Date().toISOString().slice(0, 10); }

async function consume(key: string, amount: number, limit: number, ttlSeconds: number) {
  if (!redis) {
    if (process.env.NODE_ENV === "production") throw new Error("REDIS_URL is required to enforce tenant quotas");
    return { allowed: true, used: 0, retryAfterSeconds: ttlSeconds };
  }
  if (redis.status === "wait") await redis.connect();
  const [allowed, used] = await redis.eval(
    "local current=tonumber(redis.call('GET', KEYS[1]) or '0'); local requested=tonumber(ARGV[1]); local limit=tonumber(ARGV[2]); if current + requested > limit then return {0,current} end; local value=redis.call('INCRBY', KEYS[1], requested); if value == requested then redis.call('EXPIRE', KEYS[1], ARGV[3]); end; return {1,value}",
    1, key, amount, limit, ttlSeconds
  ) as [number, number];
  return { allowed: allowed === 1, used, retryAfterSeconds: ttlSeconds };
}

export class TenantQuotaService {
  static estimateTokens(texts: string[], maxOutputTokens: number) {
    return Math.max(1, Math.ceil(texts.reduce((total, text) => total + text.length, 0) / 4)) + maxOutputTokens;
  }

  static async reserveDailyTokens(organizationId: string, expectedTokens: number, dailyBudget: number) {
    const result = await consume(`quota:tokens:${organizationId}:${dayKey()}`, expectedTokens, dailyBudget, secondsUntilUtcMidnight());
    if (!result.allowed) throw new TenantQuotaExceededError(result.retryAfterSeconds);
    return { key: `quota:tokens:${organizationId}:${dayKey()}`, reservedTokens: expectedTokens };
  }

  // Call this when a provider returns token usage. It refunds an over-reservation
  // but never increases a charge after a response has been sent.
  static async reconcileReservation(reservation: { key: string; reservedTokens: number }, actualTokens?: number) {
    if (!redis || actualTokens === undefined || actualTokens >= reservation.reservedTokens) return;
    if (redis.status === "wait") await redis.connect();
    await redis.decrby(reservation.key, reservation.reservedTokens - actualTokens);
  }

  static async consumeWidgetRequest(organizationId: string, perMinuteLimit: number) {
    const result = await consume(`quota:widget-requests:${organizationId}:${Math.floor(Date.now() / 60_000)}`, 1, perMinuteLimit, 60);
    if (!result.allowed) throw new TenantQuotaExceededError(result.retryAfterSeconds, "Widget request quota exceeded");
  }

  static async consumeWidgetEndUserRequest(organizationId: string, customerId: string, perMinuteLimit: number) {
    const result = await consume(`quota:widget-user:${organizationId}:${customerId}:${Math.floor(Date.now() / 60_000)}`, 1, Math.max(1, Math.floor(perMinuteLimit / 4)), 60);
    if (!result.allowed) throw new TenantQuotaExceededError(result.retryAfterSeconds, "Widget end-user request quota exceeded");
  }

  static async currentDailyTokenUsage(organizationId: string) {
    if (!redis) return null;
    if (redis.status === "wait") await redis.connect();
    return Number(await redis.get(`quota:tokens:${organizationId}:${dayKey()}`) || 0);
  }
}
