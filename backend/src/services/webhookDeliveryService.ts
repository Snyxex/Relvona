import crypto from "node:crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { webhookDeliveries, webhookEvents, webhookSubscriptions } from "../db/webhookSchema.js";
import { decryptSecret } from "../utils/crypto.js";
import { assertWebhookUrlAllowed } from "./webhookSecurity.js";

const MAX_ATTEMPTS = 8;
const DELIVERY_TIMEOUT_MS = 10_000;
const LEASE_MS = 2 * 60_000;

function retryDelayMs(attempt: number) {
  return Math.min(60 * 60_000, 30_000 * Math.pow(2, Math.max(0, attempt - 1)));
}

export class WebhookDeliveryService {
  static async deliverPendingForOrganization(organizationId: string, limit = 20) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
    const now = new Date();
    const candidates = await db.select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.organizationId, organizationId),
        inArray(webhookDeliveries.status, ["pending", "failed", "delivering"]),
        lte(webhookDeliveries.nextAttemptAt, now),
      ))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(safeLimit);

    let delivered = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const [claimed] = await db.update(webhookDeliveries).set({
        status: "delivering",
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        lastAttemptAt: now,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
        updatedAt: now,
      }).where(and(
        eq(webhookDeliveries.organizationId, organizationId),
        eq(webhookDeliveries.id, candidate.id),
        inArray(webhookDeliveries.status, ["pending", "failed", "delivering"]),
        lte(webhookDeliveries.nextAttemptAt, now),
      )).returning();
      if (!claimed) continue;

      const ok = await this.deliverClaimed(organizationId, claimed.id, claimed.attempts);
      if (ok) delivered += 1; else failed += 1;
    }
    return { scanned: candidates.length, delivered, failed };
  }

  private static async deliverClaimed(organizationId: string, deliveryId: string, attempt: number): Promise<boolean> {
    const [row] = await db.select({
      delivery: webhookDeliveries,
      event: webhookEvents,
      subscription: webhookSubscriptions,
    }).from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
      .innerJoin(webhookSubscriptions, eq(webhookDeliveries.subscriptionId, webhookSubscriptions.id))
      .where(and(eq(webhookDeliveries.organizationId, organizationId), eq(webhookDeliveries.id, deliveryId)))
      .limit(1);

    if (!row || !row.subscription.enabled) {
      await this.markFailure(organizationId, deliveryId, attempt, "Webhook subscription unavailable", undefined, true);
      return false;
    }

    const secret = decryptSecret(row.subscription.encryptedSecret);
    if (!secret) {
      await this.markFailure(organizationId, deliveryId, attempt, "Webhook signing secret unavailable", undefined, true);
      return false;
    }

    try {
      await assertWebhookUrlAllowed(row.subscription.url);
      const body = JSON.stringify({
        id: row.event.id,
        type: row.event.type,
        occurredAt: row.event.occurredAt.toISOString(),
        data: row.event.payload,
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      timer.unref();
      let response: Response;
      try {
        response = await fetch(row.subscription.url, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "SupportAI-Webhooks/1.0",
            "X-SupportAI-Event-Id": row.event.id,
            "X-SupportAI-Timestamp": timestamp,
            "X-SupportAI-Signature": `v1=${signature}`,
          },
          body,
        });
      } finally { clearTimeout(timer); }

      if (response.status >= 200 && response.status < 300) {
        await db.update(webhookDeliveries).set({ status: "delivered", deliveredAt: new Date(), responseStatus: response.status, error: null, updatedAt: new Date() })
          .where(and(eq(webhookDeliveries.organizationId, organizationId), eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.status, "delivering")));
        return true;
      }
      await this.markFailure(organizationId, deliveryId, attempt, `Endpoint returned HTTP ${response.status}`, response.status);
      return false;
    } catch (error) {
      await this.markFailure(organizationId, deliveryId, attempt, (error as Error).message || "Webhook delivery failed");
      return false;
    }
  }

  private static async markFailure(organizationId: string, deliveryId: string, attempt: number, error: string, responseStatus?: number, terminal = false) {
    const exhausted = terminal || attempt >= MAX_ATTEMPTS;
    await db.update(webhookDeliveries).set({
      status: exhausted ? "exhausted" : "failed",
      responseStatus,
      error: error.replace(/[\r\n]+/g, " ").slice(0, 500),
      nextAttemptAt: exhausted ? new Date("9999-12-31T00:00:00.000Z") : new Date(Date.now() + retryDelayMs(attempt)),
      updatedAt: new Date(),
    }).where(and(eq(webhookDeliveries.organizationId, organizationId), eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.status, "delivering")));
  }
}
