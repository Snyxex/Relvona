import { Router } from "express";
import { authenticate, tenantContext, AuthRequest } from "../middleware/auth.js";
import { toolRegistry } from "../services/toolRegistry.js";

const router = Router();
router.use(authenticate);
router.use(tenantContext);

const catalogToolIds = [
  "support.get_ticket_case",
  "scheduling.list_bookings",
  "scheduling.create_booking",
  "scheduling.cancel_booking",
  "demo.get_server_status",
  "demo.restart_service",
];

router.get("/", (req: AuthRequest, res) => {
  const tools = toolRegistry.getAvailableTools(
    { actorRole: req.organization!.role },
    catalogToolIds,
  ).map(({ execute: _execute, ...tool }) => tool);
  return res.json(tools);
});

export default router;
