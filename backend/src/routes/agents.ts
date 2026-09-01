import { Router } from "express";
import { authenticate, tenantContext, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { organizationMembers, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

// GET /api/v1/agents (List human support agents in organization)
router.get("/", async (req: AuthRequest, res) => {
  try {
    const agents = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, req.organization!.id));

    return res.json(agents);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
