import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { webhookDeliveries, webhookEvents, webhookSubscriptions } from "../db/webhookSchema.js";
import { encryptSecret } from "../utils/crypto.js";
import type { DomainEvent, DomainEventType } from "./domainEventBus.js";
import { assertWebhookUrlAllowed } from "./webhookSecurity.js";

export const WEBHOOK_EVENT_TYPES: DomainEventType[] = [
  "conversation.created",
  "conversation.updated",
  "message.created",
  "intent.detected",
  "ticket.created",
  "ticket.updated",
  "tool.failed",
  "customer.frustrated",
  "ai.low_confidence",
  "human_handoff.requested",
  "booking.created",
  "booking.rescheduled",
  "booking.cancelled",
];

const EVENT_SET = new Set<string>(WEBHOOK_EVENT_TYPES);

function normalizeEventTypes(value: unknown): DomainEventType[] {
  if (!Array.isArray(value)) throw new Error("eventTypes must be an array");
  const unique = [...new Set(value.filter((item): item is string => typeof item === "string"))];
  if (!unique.length || unique.length > WEBHOOK_EVENT_TYPES.length || unique.some((item) => !EVENT_SET.has(item))) throw new Error("Invalid webhook event types");
  return unique as DomainEventType[];
}

function publicSubscription(row: typeof webhookSubscriptions.$inferSelect) {
  const { encryptedSecret: _secret, ...safe } = row;
  return safe;
}

export class WebhookService {
  static async list(organizationId: string) {
    const rows = await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.organizationId, organizationId)).orderBy(desc(webhookSubscriptions.createdAt));
    return rows.map(publicSubscription);
  }

  static async create(data: { organizationId: string; name: string; url: string; eventTypes: unknown }) {
    const name = data.name.trim().slice(0, 120);
    if (!name) throw new Error("Webhook name is required");
    await assertWebhookUrlAllowed(data.url);
    const eventTypes = normalizeEventTypes(data.eventTypes);
    const secret = `whsec_${crypto.randomBytes(32).toString("base64url")}`;
    const [row] = await db.insert(webhookSubscriptions).values({
      organizationId: data.organizationId,
      name,
      url: data.url,
      eventTypes,
      encryptedSecret: encryptSecret(secret)!,
    }).returning();
    return { subscription: publicSubscription(row), secret };
  }

  static async update(data: { organizationId: string; id: string; name?: string; url?: string; eventTypes?: unknown; enabled?: boolean }) {
    const changes: Partial<typeof webhookSubscriptions.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) {
      const name = data.name.trim().slice(0, 120);
      if (!name) throw new Error("Webhook name is required");
      changes.name = name;
    }
    if (data.url !== undefined) { await assertWebhookUrlAllowed(data.url); changes.url = data.url; }
    if (data.eventTypes !== undefined) changes.eventTypes = normalizeEventTypes(data.eventTypes);
    if (data.enabled !== undefined) changes.enabled = data.enabled;
    const [row] = await db.update(webhookSubscriptions).set(changes).where(and(eq(webhookSubscriptions.organizationId, data.organizationId), eq(webhookSubscriptions.id, data.id))).returning();
    if (!row) throw new Error("Webhook subscription not found");
    return publicSubscription(row);
  }

  static async rotateSecret(organizationId: string, id: string) {
    const secret = `whsec_${crypto.randomBytes(32).toString("base64url")}`;
    const [row] = await db.update(webhookSubscriptions).set({ encryptedSecret: encryptSecret(secret)!, updatedAt: new Date() })
      .where(and(eq(webhookSubscriptions.organizationId, organizationId), eq(webhookSubscriptions.id, id))).returning();
    if (!row) throw new Error("Webhook subscription not found");
    return { subscription: publicSubscription(row), secret };
  }

  static async remove(organizationId: string, id: string) {
    const [row] = await db.delete(webhookSubscriptions).where(and(eq(webhookSubscriptions.organizationId, organizationId), eq(webhookSubscriptions.id, id))).returning({ id: webhookSubscriptions.id });
    if (!row) throw new Error("Webhook subscription not found");
  }

  static async capture(event: DomainEvent) {
    const subscriptions = await db.select().from(webhookSubscriptions).where(and(eq(webhookSubscriptions.organizationId, event.organizationId), eq(webhookSubscriptions.enabled, true)));
    const matching = subscriptions.filter((subscription) => subscription.eventTypes.includes(event.type));
    if (!matching.length) return undefined;

    const [storedEvent] = await db.insert(webhookEvents).values({
      organizationId: event.organizationId,
      type: event.type,
      payload: {
        conversationId: event.conversationId,
        ...event.payload,
      },
      occurredAt: event.occurredAt,
    }).returning();
    await db.insert(webhookDeliveries).values(matching.map((subscription) => ({
      organizationId: event.organizationId,
      subscriptionId: subscription.id,
      eventId: storedEvent.id,
    }))).onConflictDoNothing();
    return storedEvent;
  }
}
