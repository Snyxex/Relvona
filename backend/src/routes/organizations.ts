import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { organizations, organizationMembers, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
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
    const newApiKey = "sk_live_" + crypto.randomBytes(24).toString("hex");

    const [updated] = await db
      .update(organizations)
      .set({ apiKey: newApiKey, updatedAt: new Date() })
      .where(eq(organizations.id, req.organization!.id))
      .returning();

    return res.json({ apiKey: updated.apiKey });
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
