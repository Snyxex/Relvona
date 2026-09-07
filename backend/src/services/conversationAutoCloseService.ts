import { and, eq, lte } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { conversationActivities, conversations, organizationSettings } from "../db/schema.js";
import { domainEventBus } from "./domainEventBus.js";

/** Applies the organization's opt-in resolved-conversation retention policy. */
export class ConversationAutoCloseService {
  static async closeDue(organizationId: string, now = new Date()) {
    const closed = await withTenantTransaction(organizationId, async (tx) => {
      const [settings] = await tx.select({ hours: organizationSettings.resolvedAutoCloseHours }).from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId)).limit(1);
      if (!settings?.hours) return [];
      const cutoff = new Date(now.getTime() - settings.hours * 60 * 60 * 1000);
      const updated = await tx.update(conversations).set({ state: "CLOSED", updatedAt: now }).where(and(eq(conversations.organizationId, organizationId), eq(conversations.state, "RESOLVED"), lte(conversations.updatedAt, cutoff))).returning({ id: conversations.id });
      if (updated.length) await tx.insert(conversationActivities).values(updated.map((row) => ({ organizationId, conversationId: row.id, eventType: "auto_closed", payload: { policyHours: settings.hours } })));
      return updated;
    });
    await Promise.all(closed.map((row) => domainEventBus.emit({ type: "conversation.updated", organizationId, conversationId: row.id, payload: { eventType: "auto_closed", state: "CLOSED" } })));
    return closed.length;
  }
}
