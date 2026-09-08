import { logger } from "../observability/logger.js";
import { domainEventBus } from "./domainEventBus.js";
import { WEBHOOK_EVENT_TYPES, WebhookService } from "./webhookService.js";

let registered = false;

export function registerWebhookDomainBridge() {
  if (registered) return;
  registered = true;
  for (const type of WEBHOOK_EVENT_TYPES) {
    domainEventBus.subscribe(type, async (event) => {
      try { await WebhookService.capture(event); }
      catch (error) { logger.warn("webhook.outbox_capture_failed", { organizationId: event.organizationId, type: event.type, error: (error as Error).message }); }
    });
  }
}
