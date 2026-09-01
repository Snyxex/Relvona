import { Router } from "express";
import { authenticate, tenantContext, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { customers } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

// GET /api/v1/customers
router.get("/", async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(customers)
      .where(eq(customers.organizationId, req.organization!.id))
      .orderBy(desc(customers.createdAt));

    return res.json(list);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/v1/customers/:id
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, req.params.id))
      .limit(1);

    if (!customer) return res.status(404).json({ error: "Customer not found" });

    return res.json(customer);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
