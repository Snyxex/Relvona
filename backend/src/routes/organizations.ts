import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { organizations, organizationMembers, users, apiKeys } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import crypto from "crypto";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

// GET /api/v1/organizations/current
router.get("/current", async (req: AuthRequest, res) => {
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, req.organization!.id)).limit(1);
    return res.json({ organization: org, userRole: req.organization!.role });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// PUT /api/v1/organizations/current
router.put("/current", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { name, logoUrl } = req.body;

    const [updated] = await db
      .update(organizations)
      .set({
        name: name || undefined,
        logoUrl: logoUrl || undefined,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, req.organization!.id))
      .returning();

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/organizations/api-key (Regenerate API Key)
router.post("/api-key", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const newApiKey = `acs_live_${crypto.randomBytes(32).toString("base64url")}`;
    const keyPrefix = newApiKey.slice(0, 17);
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000);
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.organizationId, req.organization!.id), isNull(apiKeys.revokedAt)));
    await db.insert(apiKeys).values({ organizationId: req.organization!.id, keyPrefix, keyHash: crypto.createHash("sha256").update(newApiKey).digest("hex"), name: "Default API key", scopes: ["*"], expiresAt });
    return res.status(201).json({ apiKey: newApiKey, keyPrefix, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/v1/organizations/members
router.get("/members", async (req: AuthRequest, res) => {
  try {
    const members = await db
      .select({
        id: organizationMembers.id,
        role: organizationMembers.role,
        createdAt: organizationMembers.createdAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, req.organization!.id));

    return res.json(members);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
