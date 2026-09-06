import { promises as dns } from "node:dns";
import crypto from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizationDashboardDomains } from "../db/schema.js";

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDashboardDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  return domainPattern.test(domain) ? domain : null;
}

export function dashboardDomainFromRequest(value: string | undefined): string | null {
  if (!value) return null;
  try { return normalizeDashboardDomain(new URL(value).hostname); }
  catch { return normalizeDashboardDomain(value.split(":", 1)[0]); }
}

export async function organizationForVerifiedDashboardDomain(domain: string | null): Promise<string | null> {
  if (!domain) return null;
  const [record] = await db.select({ organizationId: organizationDashboardDomains.organizationId })
    .from(organizationDashboardDomains)
    .where(and(eq(organizationDashboardDomains.domain, domain), isNotNull(organizationDashboardDomains.verifiedAt)))
    .limit(1);
  return record?.organizationId ?? null;
}

export async function verifiedDashboardOrigins() {
  const records = await db.select({ domain: organizationDashboardDomains.domain }).from(organizationDashboardDomains).where(isNotNull(organizationDashboardDomains.verifiedAt));
  return records.map(({ domain }) => `https://${domain}`);
}

export function newDashboardDomainVerificationToken() { return crypto.randomBytes(32).toString("base64url"); }

export async function verifyDashboardDomain(domain: string, token: string) {
  const records = await dns.resolveTxt(`_supportai.${domain}`);
  return records.some((parts) => parts.join("") === `supportai-domain-verification=${token}`);
}
