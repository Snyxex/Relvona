import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { conversationActivities, conversationMessages, conversationTagLinks, conversationTags, conversations, organizationMembers, users } from "../db/schema.js";
import { AuditService } from "./auditService.js";
import { domainEventBus } from "./domainEventBus.js";

export const CONVERSATION_STATES = ["AI_ACTIVE", "NEEDS_HUMAN", "WAITING_FOR_AGENT", "AGENT_ACTIVE", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"] as const;
export const CONVERSATION_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const transitions: Record<string, readonly string[]> = {
  AI_ACTIVE: ["NEEDS_HUMAN", "WAITING_FOR_AGENT", "CLOSED"],
  NEEDS_HUMAN: ["WAITING_FOR_AGENT", "CLOSED"],
  WAITING_FOR_AGENT: ["AGENT_ACTIVE", "CLOSED"],
  AGENT_ACTIVE: ["WAITING_FOR_CUSTOMER", "RESOLVED", "WAITING_FOR_AGENT"],
  WAITING_FOR_CUSTOMER: ["AGENT_ACTIVE", "RESOLVED", "CLOSED"],
  RESOLVED: ["AGENT_ACTIVE", "CLOSED"],
  CLOSED: ["WAITING_FOR_AGENT"],
};

export class ConversationWorkflowService {
  static async event(organizationId: string, conversationId: string, eventType: string, actorUserId?: string | null, payload: Record<string, unknown> = {}) {
    await db.insert(conversationActivities).values({ organizationId, conversationId, eventType, actorUserId: actorUserId || null, payload });
    await domainEventBus.emit({ type: "conversation.updated", organizationId, conversationId, payload: { eventType, ...payload } });
  }

  static async transition(input: { organizationId: string; conversationId: string; actorUserId: string; target: string }) {
    if (!CONVERSATION_STATES.includes(input.target as any)) throw new Error("Invalid conversation state");
    const [current] = await db.select().from(conversations).where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId))).limit(1);
    if (!current) throw new Error("Conversation not found");
    if (!transitions[current.state]?.includes(input.target)) throw new Error("Invalid conversation state transition");
    const [updated] = await db.update(conversations).set({ state: input.target, updatedAt: new Date() }).where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId), eq(conversations.state, current.state))).returning();
    if (!updated) throw new Error("Conversation was updated by another agent");
    await this.event(input.organizationId, input.conversationId, "status_changed", input.actorUserId, { from: current.state, to: input.target });
    await AuditService.logAction({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: `conversation.${input.target.toLowerCase()}`, resourceType: "conversation", resourceId: input.conversationId, metadata: { from: current.state, to: input.target } });
    return updated;
  }

  static async assign(input: { organizationId: string; conversationId: string; actorUserId: string; assigneeId: string | null }) {
    if (input.assigneeId) {
      const [member] = await db.select({ id: organizationMembers.id }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, input.organizationId), eq(organizationMembers.userId, input.assigneeId), inArray(organizationMembers.role, ["owner", "admin", "agent"]), eq(organizationMembers.status, "active"))).limit(1);
      if (!member) throw new Error("Assignee is not an active support agent");
    }
    const [before] = await db.select({ assignedAgentId: conversations.assignedAgentId, state: conversations.state }).from(conversations).where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId))).limit(1);
    if (!before) throw new Error("Conversation not found");
    // A claim is conditional: an already-owned conversation cannot be stolen by an agent.
    const condition = input.assigneeId && before.assignedAgentId === null ? sql`${conversations.assignedAgentId} IS NULL` : before.assignedAgentId === null ? sql`${conversations.assignedAgentId} IS NULL` : eq(conversations.assignedAgentId, before.assignedAgentId);
    const [updated] = await db.update(conversations).set({ assignedAgentId: input.assigneeId, state: input.assigneeId && before.state === "WAITING_FOR_AGENT" ? "AGENT_ACTIVE" : before.state, updatedAt: new Date() }).where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId), condition)).returning();
    if (!updated) throw new Error("Conversation is already assigned to another agent");
    await this.event(input.organizationId, input.conversationId, input.assigneeId ? "assignment_changed" : "unassigned", input.actorUserId, { from: before.assignedAgentId, to: input.assigneeId });
    await AuditService.logAction({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: input.assigneeId ? "conversation.assigned" : "conversation.unassigned", resourceType: "conversation", resourceId: input.conversationId, metadata: { assigneeId: input.assigneeId } });
    return updated;
  }

  static async changePriority(input: { organizationId: string; conversationId: string; actorUserId: string; priority: string }) {
    if (!CONVERSATION_PRIORITIES.includes(input.priority as any)) throw new Error("Invalid conversation priority");
    const [before] = await db.select({ priority: conversations.priority }).from(conversations).where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId))).limit(1);
    if (!before) throw new Error("Conversation not found");
    const [updated] = await db.update(conversations).set({ priority: input.priority, updatedAt: new Date() }).where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId))).returning();
    await this.event(input.organizationId, input.conversationId, "priority_changed", input.actorUserId, { from: before.priority, to: input.priority });
    await AuditService.logAction({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "conversation.priority_changed", resourceType: "conversation", resourceId: input.conversationId, metadata: { from: before.priority, to: input.priority } });
    return updated;
  }

  static async addInternalNote(input: { organizationId: string; conversationId: string; actorUserId: string; actorName: string; content: string }) {
    const [message] = await db.insert(conversationMessages).values({ organizationId: input.organizationId, conversationId: input.conversationId, senderType: "internal_note", senderId: input.actorUserId, senderName: input.actorName, content: input.content }).returning();
    await this.event(input.organizationId, input.conversationId, "internal_note_added", input.actorUserId, { messageId: message.id });
    await AuditService.logAction({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "conversation.internal_note_added", resourceType: "conversation", resourceId: input.conversationId });
    await domainEventBus.emit({ type: "message.created", organizationId: input.organizationId, conversationId: input.conversationId, payload: message });
    return message;
  }

  static async setTags(input: { organizationId: string; conversationId: string; actorUserId: string; tagIds: string[] }) {
    const tags = input.tagIds.length ? await db.select({ id: conversationTags.id }).from(conversationTags).where(and(eq(conversationTags.organizationId, input.organizationId), inArray(conversationTags.id, input.tagIds))) : [];
    if (tags.length !== input.tagIds.length) throw new Error("One or more tags do not belong to this organization");
    await db.transaction(async (tx) => { await tx.delete(conversationTagLinks).where(and(eq(conversationTagLinks.organizationId, input.organizationId), eq(conversationTagLinks.conversationId, input.conversationId))); if (tags.length) await tx.insert(conversationTagLinks).values(tags.map((tag) => ({ organizationId: input.organizationId, conversationId: input.conversationId, tagId: tag.id }))); });
    await this.event(input.organizationId, input.conversationId, "tags_changed", input.actorUserId, { tagIds: input.tagIds });
  }
}
