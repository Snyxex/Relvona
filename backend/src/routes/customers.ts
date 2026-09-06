import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { customers, analyticsEvents } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { AuditService } from "../services/auditService.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);
// Customer records contain personal data. A Viewer may inspect aggregate
// analytics but must not enumerate or retrieve individual customers.
router.use(requireRole(["owner", "admin", "agent"]));

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
      .where(and(eq(customers.id, req.params.id), eq(customers.organizationId, req.organization!.id)))
      .limit(1);

    if (!customer) return res.status(404).json({ error: "Customer not found" });

    return res.json(customer);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// DELETE /api/v1/customers/:id -- GDPR right-to-be-forgotten.
// Customer FK cascades remove conversations, messages, tickets, and their child rows.
router.delete("/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const [deleted] = await db.delete(customers).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, req.organization!.id))).returning({ id: customers.id });
    if (!deleted) return res.status(404).json({ error: "Customer not found" });
    await db.insert(analyticsEvents).values({ organizationId: req.organization!.id, eventType: "customer_erased", metadata: { customerId: deleted.id, scope: ["customer", "conversations", "messages", "tickets"] } });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "customer.erase", resourceType: "customer", resourceId: deleted.id });
    return res.status(202).json({ status: "erased", customerId: deleted.id, erased: ["customer", "conversations", "messages", "tickets"] });
  } catch (error) { return res.status(500).json({ error: "Unable to erase customer data" }); }
});

export default router;
