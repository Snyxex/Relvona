import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";

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

// Middleware: Express Security Headers
export function applySecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

// Middleware: Dynamic Rate Limiter
export function createRateLimiter(options: { limit: number; windowMs: number; keyPrefix: string }) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown_ip";
    const orgId = req.organization?.id || "public_org";
    const userId = req.user?.id || "anon";

    const key = `${options.keyPrefix}:${ip}:${orgId}:${userId}`;

    if (limiter.isRateLimited(key, options.limit, options.windowMs)) {
      return res.status(429).json({
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please wait before retrying.",
        retryAfterMs: options.windowMs,
      });
    }

    next();
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
