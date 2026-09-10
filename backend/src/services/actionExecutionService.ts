import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { actionExecutions } from "../db/actionExecutionSchema.js";
import { conversationSchedulingStates } from "../db/conversationSchedulingSchema.js";
import { conversationMessages, conversations } from "../db/schema.js";
import { domainEventBus } from "./domainEventBus.js";
import { toolRegistry, type ToolExecutionContext } from "./toolRegistry.js";
import { validateToolInput } from "./toolInputValidator.js";
import { detectSchedulingLanguage, formatSchedulingSlot, schedulingText } from "./schedulingLanguage.js";

const terminalStatuses = new Set(["rejected", "executed", "failed", "expired"]);

async function bookingConfirmation(conversationId: string, organizationId: string, startsAt: Date, timezone: string, meetingUrl?: string | null) {
  const [lastCustomerMessage] = await db.select({ content: conversationMessages.content })
    .from(conversationMessages)
    .where(and(eq(conversationMessages.organizationId, organizationId), eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.senderType, "customer")))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(1);
  const language = detectSchedulingLanguage(lastCustomerMessage?.content);
  return schedulingText(language).confirmed(formatSchedulingSlot(startsAt, timezone, language, true), meetingUrl);
}

export class ActionExecutionService {
  static async request(data: { context: ToolExecutionContext; toolId: string; input: Record<string, unknown>; requestedByType?: "ai" | "user" | "system"; requestedByUserId?: string; idempotencyKey?: string }) {
    const tool = toolRegistry.get(data.toolId); if (!tool) throw new Error("Unknown tool");
    if (data.context.actorRole === "viewer" && tool.riskLevel !== "read") throw new Error("Tool not permitted for viewer role");
    const validation = validateToolInput(tool.inputSchema, data.input);
    if (!validation.valid) throw new Error(`Invalid tool input: ${validation.error}`);
    if (data.idempotencyKey) {
      const [existing] = await db.select().from(actionExecutions).where(and(
        eq(actionExecutions.organizationId, data.context.organizationId),
        eq(actionExecutions.toolId, tool.id),
        eq(actionExecutions.idempotencyKey, data.idempotencyKey),
      )).limit(1);
      if (existing) return existing;
    }
    const status = tool.requiresApproval ? "pending" : "approved";
    const values = { organizationId: data.context.organizationId, conversationId: data.context.conversationId, customerId: data.context.customerId, toolId: tool.id, input: data.input, status, riskLevel: tool.riskLevel, requiresApproval: tool.requiresApproval, requestedByType: data.requestedByType || "ai", requestedByUserId: data.requestedByUserId, idempotencyKey: data.idempotencyKey, expiresAt: new Date(Date.now() + 30 * 60 * 1000), approvedAt: tool.requiresApproval ? undefined : new Date() };
    const inserted = data.idempotencyKey
      ? await db.insert(actionExecutions).values(values).onConflictDoNothing({ target: [actionExecutions.organizationId, actionExecutions.toolId, actionExecutions.idempotencyKey] }).returning()
      : await db.insert(actionExecutions).values(values).returning();
    let execution = inserted[0];
    if (!execution && data.idempotencyKey) {
      [execution] = await db.select().from(actionExecutions).where(and(eq(actionExecutions.organizationId, data.context.organizationId), eq(actionExecutions.toolId, tool.id), eq(actionExecutions.idempotencyKey, data.idempotencyKey))).limit(1);
    }
    if (!execution) throw new Error("Unable to create action execution");
    if (!tool.requiresApproval) return this.execute({ organizationId: data.context.organizationId, executionId: execution.id, context: data.context });
    return execution;
  }

  static async list(organizationId: string, status?: string) { return db.select().from(actionExecutions).where(and(eq(actionExecutions.organizationId, organizationId), status ? eq(actionExecutions.status, status) : undefined)).orderBy(desc(actionExecutions.createdAt)); }

  private static async assertIndependentDecision(organizationId: string, executionId: string, userId: string) {
    const [execution] = await db.select({ requestedByType: actionExecutions.requestedByType, requestedByUserId: actionExecutions.requestedByUserId })
      .from(actionExecutions)
      .where(and(eq(actionExecutions.organizationId, organizationId), eq(actionExecutions.id, executionId)))
      .limit(1);
    if (!execution) throw new Error("Action execution not found");
    if (execution.requestedByType === "user" && execution.requestedByUserId === userId) {
      throw new Error("Action requester cannot approve or reject their own action");
    }
  }

  static async approve(data: { organizationId: string; executionId: string; userId: string; reason?: string }) {
    await this.assertIndependentDecision(data.organizationId, data.executionId, data.userId);
    const [updated] = await db.update(actionExecutions).set({ status: "approved", approvedByUserId: data.userId, approvedAt: new Date(), decisionReason: data.reason?.slice(0, 1000), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, data.executionId), eq(actionExecutions.status, "pending"), or(isNull(actionExecutions.expiresAt), gt(actionExecutions.expiresAt, new Date())))).returning();
    if (!updated) throw new Error("Action is not pending or has expired"); return updated;
  }

  static async reject(data: { organizationId: string; executionId: string; userId: string; reason?: string }) {
    await this.assertIndependentDecision(data.organizationId, data.executionId, data.userId);
    const [updated] = await db.update(actionExecutions).set({ status: "rejected", rejectedByUserId: data.userId, rejectedAt: new Date(), decisionReason: data.reason?.slice(0, 1000), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, data.executionId), eq(actionExecutions.status, "pending"))).returning();
    if (!updated) throw new Error("Action is not pending"); await db.update(conversationSchedulingStates).set({ state: "cancelled", updatedAt: new Date() }).where(and(eq(conversationSchedulingStates.organizationId, data.organizationId), eq(conversationSchedulingStates.actionExecutionId, data.executionId))); return updated;
  }

  static async execute(data: { organizationId: string; executionId: string; context: ToolExecutionContext }) {
    const [execution] = await db.select().from(actionExecutions).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, data.executionId))).limit(1); if (!execution) throw new Error("Action execution not found");
    if (terminalStatuses.has(execution.status)) return execution;
    if (execution.expiresAt && execution.expiresAt <= new Date()) { const [expired] = await db.update(actionExecutions).set({ status: "expired", updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id))).returning(); return expired; }
    if (execution.status !== "approved") throw new Error("Action must be approved before execution");
    const tool = toolRegistry.get(execution.toolId); if (!tool) throw new Error("Tool no longer exists");
    const input = execution.input as Record<string, unknown>;
    const validation = validateToolInput(tool.inputSchema, input);
    if (!validation.valid) {
      const [failed] = await db.update(actionExecutions).set({ status: "failed", error: `Invalid tool input: ${validation.error}`.slice(0, 2000), executedAt: new Date(), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id), eq(actionExecutions.status, "approved"))).returning();
      return failed || execution;
    }
    const [claimed] = await db.update(actionExecutions).set({ status: "executing", updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id), eq(actionExecutions.status, "approved"))).returning(); if (!claimed) throw new Error("Action is already being executed");
    try {
      const result = await tool.execute({ ...data.context, organizationId: data.organizationId, conversationId: execution.conversationId || data.context.conversationId, customerId: execution.customerId || data.context.customerId }, input);
      const [finished] = await db.update(actionExecutions).set({ status: result.success ? "executed" : "failed", result: result.data || null, error: result.success ? null : (result.error || "Tool execution failed").slice(0, 2000), executedAt: new Date(), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id))).returning();
      if (result.success && execution.toolId === "scheduling.create_booking") {
        const booking = (result.data as any)?.booking;
        if (booking?.id) {
          await db.update(conversationSchedulingStates).set({ state: "booked", bookingId: booking.id, updatedAt: new Date() }).where(and(eq(conversationSchedulingStates.organizationId, data.organizationId), eq(conversationSchedulingStates.actionExecutionId, execution.id)));
          if (execution.conversationId) {
            const [conversation] = await db.select({ assistantId: conversations.assistantId }).from(conversations).where(and(eq(conversations.organizationId, data.organizationId), eq(conversations.id, execution.conversationId))).limit(1);
            if (conversation?.assistantId) {
              const content = await bookingConfirmation(execution.conversationId, data.organizationId, new Date(booking.startsAt), booking.timezone, booking.meetingUrl);
              const [message] = await db.insert(conversationMessages).values({ organizationId: data.organizationId, conversationId: execution.conversationId, senderType: "ai", senderId: conversation.assistantId, senderName: "AI Assistant", content }).returning();
              await domainEventBus.emit({ type: "message.created", organizationId: data.organizationId, conversationId: execution.conversationId, payload: message });
            }
          }
        }
      }
      return finished;
    } catch (error) {
      const [failed] = await db.update(actionExecutions).set({ status: "failed", error: (error as Error).message.slice(0, 2000), executedAt: new Date(), updatedAt: new Date() }).where(and(eq(actionExecutions.organizationId, data.organizationId), eq(actionExecutions.id, execution.id))).returning(); return failed;
    }
  }
}
