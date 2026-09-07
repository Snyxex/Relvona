import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { organizationMembers, users } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent"]));

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
      .where(and(eq(organizationMembers.organizationId, req.organization!.id), eq(organizationMembers.role, "agent")));

    return res.json(agents);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "AGENTS_LIST_FAILED", message: "Unable to load support agents" });
  }
});

export default router;
