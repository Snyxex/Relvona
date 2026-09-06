import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import Redis from "ioredis";
import { dashboardDomainFromRequest, organizationForVerifiedDashboardDomain } from "../services/dashboardDomainService.js";

// In-Memory Token Bucket Rate Limiter
class RateLimiter {
  private buckets: Map<string, { count: number; resetTime: number }> = new Map();

  isRateLimited(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now > bucket.resetTime) {
      this.buckets.set(key, { count: 1, resetTime: now + windowMs });
      return false;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      return true;
    }

    return false;
  }
}

const limiter = new RateLimiter();
const redisUrl = process.env.REDIS_URL;
const redisLimiter = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true }) : null;

async function consumeDistributedLimit(key: string, limit: number, windowMs: number): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  if (!redisLimiter) {
    if (process.env.NODE_ENV === "production") throw new Error("REDIS_URL is required for public rate limiting");
    return { limited: limiter.isRateLimited(key, limit, windowMs), retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  if (redisLimiter.status === "wait") await redisLimiter.connect();
  const bucket = `rate-limit:${key}`;
  const [count, ttl] = await redisLimiter.eval(
    "local count=redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return {count, redis.call('PTTL', KEYS[1])}",
    1,
    bucket,
    windowMs
  ) as [number, number];
  return { limited: count > limit, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
}

// Middleware: Express Security Headers
export function applySecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  const isHostedWidgetPage = req.path.startsWith("/api/v1/widget/page/");
  res.setHeader("X-Frame-Options", isHostedWidgetPage ? "SAMEORIGIN" : "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (isHostedWidgetPage) {
    res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
  } else if (!req.path.startsWith("/public/")) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  }
  next();
}

/**
 * Browser dashboard APIs authenticate via HttpOnly cookies, so unsafe methods
 * additionally require a configured first-party Origin. API-key integrations
 * are exempt because they do not authenticate with browser cookies.
 */
export async function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.path.startsWith('/api/v1/widget/') || req.path.startsWith('/api/auth/')) return next();
  const hasSessionCookie = hasBetterAuthSessionCookie(req.headers.cookie);
  if (!hasSessionCookie || req.headers['x-api-key']) return next();
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origin) return res.status(403).json({ error: 'CSRF_ORIGIN_REJECTED' });
  if (!allowed.includes(origin) && !await organizationForVerifiedDashboardDomain(dashboardDomainFromRequest(origin))) return res.status(403).json({ error: 'CSRF_ORIGIN_REJECTED' });
  return next();
}

/** Better Auth uses the `__Secure-` cookie prefix when secure cookies are on. */
export function hasBetterAuthSessionCookie(cookieHeader: string | undefined) {
  return /(?:^|;\s*)(?:__Secure-)?supportai\.session_token=/.test(cookieHeader || '');
}

// Middleware: Dynamic Rate Limiter
export function createRateLimiter(options: { limit: number; windowMs: number; keyPrefix: string; keyGenerator?: (req: AuthRequest) => string | undefined }) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown_ip";
    const orgId = req.organization?.id || "public_org";
    const userId = req.user?.id || "anon";

    const key = `${options.keyPrefix}:${options.keyGenerator?.(req) || `${ip}:${orgId}:${userId}`}`;

    try {
      const { limited, retryAfterSeconds } = await consumeDistributedLimit(key, options.limit, options.windowMs);
      res.setHeader("RateLimit-Limit", options.limit);
      res.setHeader("RateLimit-Remaining", limited ? "0" : "unknown");
      res.setHeader("RateLimit-Reset", Math.ceil(Date.now() / 1000) + retryAfterSeconds);
      if (!limited) return next();
      res.setHeader("Retry-After", retryAfterSeconds);
      return res.status(429).json({
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please wait before retrying.",
        retryAfterMs: retryAfterSeconds * 1000,
      });
    } catch (error) {
      return res.status(503).json({ error: "Rate limit service unavailable" });
    }
  };
}

// Middleware: Validate Customer Input Length Caps
export function validateInputLimits(req: Request, res: Response, next: NextFunction) {
  if (req.body && req.body.content && typeof req.body.content === "string") {
    if (req.body.content.length > 2000) {
      return res.status(400).json({ error: "Input text exceeds maximum allowed limit of 2,000 characters." });
    }
  }

  if (req.body && req.body.customerQuery && typeof req.body.customerQuery === "string") {
    if (req.body.customerQuery.length > 2000) {
      return res.status(400).json({ error: "Customer query exceeds maximum allowed limit of 2,000 characters." });
    }
  }

  next();
}
