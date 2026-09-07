import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { customers, analyticsEvents } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { AuditService } from "../services/auditService.js";
import { sendInternalError } from "../utils/httpErrors.js";

const router = Router();
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 100_000;

function pagination(query: AuthRequest["query"]) {
  const requestedLimit = Number(query.limit ?? DEFAULT_PAGE_SIZE);
  const requestedOffset = Number(query.offset ?? 0);
  const limit = Number.isInteger(requestedLimit) ? Math.min(MAX_PAGE_SIZE, Math.max(1, requestedLimit)) : DEFAULT_PAGE_SIZE;
  const offset = Number.isInteger(requestedOffset) ? Math.min(MAX_OFFSET, Math.max(0, requestedOffset)) : 0;
  return { limit, offset };
}

router.use(authenticate);
router.use(tenantContext);
router.use(requireRole(["owner", "admin", "agent"]));

router.get("/", async (req: AuthRequest, res) => {
  try {
    const { limit, offset } = pagination(req.query);
    const list = await db.select().from(customers)
      .where(eq(customers.organizationId, req.organization!.id))
      .orderBy(desc(customers.createdAt), desc(customers.id))
      .limit(limit)
      .offset(offset);
    res.setHeader("X-Page-Limit", String(limit));
    res.setHeader("X-Page-Offset", String(offset));
    return res.json(list);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "CUSTOMERS_LIST_FAILED", message: "Unable to load customers" });
  }
});

router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, req.organization!.id))).limit(1);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    return res.json(customer);
  } catch (error) {
    return sendInternalError(req, res, error, { code: "CUSTOMER_LOAD_FAILED", message: "Unable to load customer" });
  }
});

router.delete("/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const [deleted] = await db.delete(customers).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, req.organization!.id))).returning({ id: customers.id });
    if (!deleted) return res.status(404).json({ error: "Customer not found" });
    await db.insert(analyticsEvents).values({ organizationId: req.organization!.id, eventType: "customer_erased", metadata: { customerId: deleted.id, scope: ["customer", "conversations", "messages", "tickets"] } });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "customer.erase", resourceType: "customer", resourceId: deleted.id });
    return res.status(202).json({ status: "erased", customerId: deleted.id, erased: ["customer", "conversations", "messages", "tickets"] });
  } catch (error) {
    return sendInternalError(req, res, error, { code: "CUSTOMER_ERASE_FAILED", message: "Unable to erase customer data" });
  }
});

export default router;
