import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { actionExecutions } from "../db/actionExecutionSchema.js";
import { toolRegistry, type ToolExecutionContext } from "./toolRegistry.js";

const terminalStatuses = new Set(["rejected", "executed", "failed", "expired"]);

export class ActionExecutionService {
  static async request(data: {
    context: ToolExecutionContext;
    toolId: string;
    input: Record<string, unknown>;
    requestedByType?: "ai" | "user" | "system";
    requestedByUserId?: string;
    idempotencyKey?: string;
  }) {
    const tool = toolRegistry.get(data.toolId);
    if (!tool) throw new Error("Unknown tool");
    if (data.context.actorRole === "viewer" && tool.riskLevel !== "read") throw new Error("Tool not permitted for viewer role");
    if (data.idempotencyKey) {
      const [existing] = await db.select().from(actionExecutions).where(and(eq(actionExecutions.organizationId, data.context.organizationId), eq(actionExecutions.idempotencyKey, data.idempotencyKey))).limit(1);
      if (existing) return existing;
    }
    const status = tool.requiresApproval ? "pending" : "approved";
    const [execution] = await db.insert(actionExecutions).values({
      organizationId: data.context.organizationId,
      conversationId: data.context.conversationId,
      customerId: data.context.customerId,
      toolId: tool.id,
      input: data.input,
      status,
      riskLevel: tool.riskLevel,
      requiresApproval: tool.requiresApproval,
      requestedByType: data.requestedByType || "ai",
      requestedByUserId: data.requestedByUserId,
      idempotencyKey: data.idempotencyKey,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      approvedAt: tool.requiresApproval ? undefined : new Date(),
    }).returning();
    if (!tool.requiresApproval) return this.execute({ organizationId: data.context.organizationId, executionId: execution.id, context: data.context });
    return execution;
  }

  static async list(organizationId: string, status?: string) {
    return db.select().from(actionExecutions).where(and(eq(actionExecutions.organizationId, organizationId), status ? eq(actionExecutions.status, status) : undefined)).orderBy(desc(actionExecutions.createdAt));
  }

  static async approve(data: { organizationId: string; executionId: string; userId: string; reason?: string }) {
    const [updated] = await db.update(actionExecutions).set({ status: "approved", approvedByUserId: data.userId, approvedAt: new Date(), decisionReason: data.reason?.slice(0, 1000), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, data.executionId), eq(actionExecutions.status, "pending"), or(isNull(actionExecutions.expiresAt), gt(actionExecutions.expiresAt, new Date())))).returning();
    if (!updated) throw new Error("Action is not pending or has expired");
    return updated;
  }

  static async reject(data: { organizationId: string; executionId: string; userId: string; reason?: string }) {
    const [updated] = await db.update(actionExecutions).set({ status: "rejected", rejectedByUserId: data.userId, rejectedAt: new Date(), decisionReason: data.reason?.slice(0, 1000), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, data.executionId), eq(actionExecutions.status, "pending"))).returning();
    if (!updated) throw new Error("Action is not pending");
    return updated;
  }

  static async execute(data: { organizationId: string; executionId: string; context: ToolExecutionContext }) {
    const [execution] = await db.select().from(actionExecutions).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, data.executionId))).limit(1);
    if (!execution) throw new Error("Action execution not found");
    if (terminalStatuses.has(execution.status)) return execution;
    if (execution.expiresAt && execution.expiresAt <= new Date()) {
      const [expired] = await db.update(actionExecutions).set({ status: "expired", updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id))).returning();
      return expired;
    }
    if (execution.status !== "approved") throw new Error("Action must be approved before execution");
    const tool = toolRegistry.get(execution.toolId);
    if (!tool) throw new Error("Tool no longer exists");
    const [claimed] = await db.update(actionExecutions).set({ status: "executing", updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id), eq(actionExecutions.status, "approved"))).returning();
    if (!claimed) throw new Error("Action is already being executed");
    try {
      const result = await tool.execute({ ...data.context, organizationId: data.organizationId, conversationId: execution.conversationId || data.context.conversationId, customerId: execution.customerId || data.context.customerId }, execution.input as Record<string, unknown>);
      const [finished] = await db.update(actionExecutions).set({ status: result.success ? "executed" : "failed", result: result.data || null, error: result.success ? null : (result.error || "Tool execution failed").slice(0, 2000), executedAt: new Date(), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id))).returning();
      return finished;
    } catch (error) {
      const [failed] = await db.update(actionExecutions).set({ status: "failed", error: (error as Error).message.slice(0, 2000), executedAt: new Date(), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id))).returning();
      return failed;
    }
  }
}
