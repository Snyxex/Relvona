import { Router } from "express";
import { authenticate, AuthRequest, requireRole, tenantContext } from "../middleware/auth.js";
import { EmployeeDirectoryService } from "../services/employeeDirectoryService.js";
import { AuditService } from "../services/auditService.js";

const router = Router();
router.use(authenticate, tenantContext, requireRole(["owner", "admin"]));

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const [employees, members] = await Promise.all([
      EmployeeDirectoryService.list(req.organization!.id),
      EmployeeDirectoryService.listAssignableMembers(req.organization!.id),
    ]);
    res.json({ employees, members });
  } catch (error) { next(error); }
});

router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const employee = await EmployeeDirectoryService.create(req.organization!.id, req.body || {});
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "employee_directory.create", resourceType: "employee", resourceId: employee.id, metadata: { displayName: employee.displayName, userId: employee.userId } });
    res.status(201).json(employee);
  } catch (error) { next(error); }
});

router.put("/:id", async (req: AuthRequest, res, next) => {
  try {
    const employee = await EmployeeDirectoryService.update(req.organization!.id, req.params.id, req.body || {});
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "employee_directory.update", resourceType: "employee", resourceId: employee.id, metadata: { displayName: employee.displayName, userId: employee.userId } });
    res.json(employee);
  } catch (error) { next(error); }
});

router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    await EmployeeDirectoryService.remove(req.organization!.id, req.params.id);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "employee_directory.delete", resourceType: "employee", resourceId: req.params.id });
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
