import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { domainEventBus } from "./domainEventBus.js";
import { IntegrationSyncService } from "./integrationSyncService.js";

let registered = false;

export function registerIntegrationSyncBridge() {
  if (registered) return;
  registered = true;
  domainEventBus.subscribe("ticket.created", async (event) => {
    await withDatabaseTenantContext(async () => {
      setDatabaseTenant(event.organizationId);
      await IntegrationSyncService.handleDomainEvent(event);
    });
  });
}
