import { Router } from "express";
import { AuthService } from "../services/authService.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../middleware/security.js";

const router = Router();

// POST /api/v1/auth/register
router.post("/register", createRateLimiter({ keyPrefix: "register", limit: 5, windowMs: 60 * 60_000, keyGenerator: (req) => req.ip }), async (req, res) => {
  try {
    const { name, email, password, orgName } = req.body;

    if (![name, email, password, orgName].every((value) => typeof value === "string" && value.trim())) {
      return res.status(400).json({ error: "Missing required fields: name, email, password, orgName" });
    }

    if (typeof name !== "string" || name.trim().length < 2 || name.length > 100 || typeof orgName !== "string" || orgName.trim().length < 2 || orgName.length > 120 || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 12 || password.length > 256) {
      return res.status(400).json({ error: "Invalid registration data" });
    }

    const result = await AuthService.registerUser({ name, email, password, orgName });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

// POST /api/v1/auth/login
const emailRateKey = (req: any) => typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "invalid";
router.post("/login", createRateLimiter({ keyPrefix: "login-account", limit: 5, windowMs: 60_000, keyGenerator: emailRateKey }), createRateLimiter({ keyPrefix: "login-ip", limit: 20, windowMs: 15 * 60_000, keyGenerator: (req) => req.ip }), async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await AuthService.loginUser({ email, password });
    return res.json(result);
  } catch (error) {
    return res.status(401).json({ error: (error as Error).message });
  }
});

router.post("/logout", authenticate, async (req: AuthRequest, res) => {
  await db.update(users).set({ tokenVersion: req.user!.tokenVersion + 1, updatedAt: new Date() }).where(eq(users.id, req.user!.id));
  return res.status(204).end();
});

// GET /api/v1/auth/me
router.get("/me", authenticate, async (req: AuthRequest, res) => {
  return res.json({ user: req.user });
});

router.patch("/me/preferences", authenticate, async (req: AuthRequest, res) => {
  const { preferredLanguage, name, avatarUrl } = req.body || {};
  if (preferredLanguage !== undefined && !['de', 'en', 'es', 'fr'].includes(preferredLanguage)) {
    return res.status(400).json({ error: "Unsupported preferred language" });
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100)) {
    return res.status(400).json({ error: "Name must contain between 2 and 100 characters" });
  }
  const validAvatar = avatarUrl === null || (typeof avatarUrl === "string" && avatarUrl.length <= 1_500_000 && (/^https:\/\//.test(avatarUrl) || /^data:image\/(png|jpe?g|webp);base64,/.test(avatarUrl)));
  if (avatarUrl !== undefined && !validAvatar) {
    return res.status(400).json({ error: "Profile image must be an HTTPS URL or a PNG, JPEG, or WebP image up to 1 MB" });
  }
  const [user] = await db.update(users).set({
    preferredLanguage: preferredLanguage ?? undefined,
    name: typeof name === "string" ? name.trim() : undefined,
    avatarUrl: avatarUrl === undefined ? undefined : avatarUrl,
    updatedAt: new Date(),
  }).where(eq(users.id, req.user!.id)).returning();
  return res.json({ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, preferredLanguage: user.preferredLanguage, systemRole: user.systemRole });
});

export default router;
