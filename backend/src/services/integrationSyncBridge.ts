import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { domainEventBus, type DomainEventType } from "./domainEventBus.js";
import { IntegrationSyncService } from "./integrationSyncService.js";

let registered = false;
const syncEventTypes: DomainEventType[] = ["ticket.created", "ticket.updated", "ticket.comment.created"];

export function registerIntegrationSyncBridge() {
  if (registered) return;
  registered = true;
  for (const type of syncEventTypes) {
    domainEventBus.subscribe(type, async (event) => {
      if (event.type === "ticket.updated" && event.payload.source === "zendesk") return;
      await withDatabaseTenantContext(async () => {
        setDatabaseTenant(event.organizationId);
        await IntegrationSyncService.handleDomainEvent(event);
      });
    });
  }
}
