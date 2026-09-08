import { gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizations } from "../db/schema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { WebhookDeliveryService } from "./webhookDeliveryService.js";

export class WebhookDeliverySweepService {
  static async sweepAll(shouldStop: () => boolean = () => false) {
    let cursor: string | undefined;
    let delivered = 0;
    let failed = 0;
    while (!shouldStop()) {
      const tenants = await db.select({ id: organizations.id }).from(organizations)
        .where(cursor ? gt(organizations.id, cursor) : undefined)
        .orderBy(organizations.id)
        .limit(100);
      if (!tenants.length) break;
      for (const tenant of tenants) {
        if (shouldStop()) return { delivered, failed };
        const result = await withDatabaseTenantContext(async () => {
          setDatabaseTenant(tenant.id);
          return WebhookDeliveryService.deliverPendingForOrganization(tenant.id, 20);
        });
        delivered += result.delivered;
        failed += result.failed;
      }
      cursor = tenants[tenants.length - 1].id;
    }
    return { delivered, failed };
  }
}
