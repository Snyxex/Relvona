import { domainEventBus } from "./domainEventBus.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { SupportAutomationService } from "./supportAutomationService.js";

let registered = false;
export function registerSupportAutomationBridge() {
  if (registered) return;
  registered = true;
  for (const trigger of ["ticket.created", "ticket.updated"] as const) {
    domainEventBus.subscribe(trigger, async event => {
      const ticketId = typeof event.payload.id === "string" ? event.payload.id : null;
      const source = typeof event.payload.source === "string" ? event.payload.source : undefined;
      if (!ticketId || source === "automation_rules") return;
      // The ticket's persisted revision is a stable key even if the event is delivered twice.
      const rawDate = trigger === "ticket.created" ? event.payload.createdAt : event.payload.updatedAt;
      const date = rawDate instanceof Date ? rawDate
        : typeof rawDate === "string" ? new Date(rawDate) : event.occurredAt;
      await withDatabaseTenantContext(async () => {
        setDatabaseTenant(event.organizationId);
        await SupportAutomationService.handleTicketEvent(event.organizationId, ticketId, trigger,
          Number.isFinite(date.getTime()) ? date : event.occurredAt, source);
      });
    });
  }
}
