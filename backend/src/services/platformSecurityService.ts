import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformAuditLogs, platformSecuritySettings } from "../db/schema.js";

export const TWO_FACTOR_POLICIES = ["required", "recommended", "disabled"] as const;
export type TwoFactorPolicy = typeof TWO_FACTOR_POLICIES[number];

let cached: { value: TwoFactorPolicy; expiresAt: number } | null = null;

export async function getTwoFactorPolicy(): Promise<TwoFactorPolicy> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [row] = await db.select({ value: platformSecuritySettings.twoFactorPolicy })
    .from(platformSecuritySettings)
    .where(eq(platformSecuritySettings.id, "global"))
    .limit(1);
  const value = TWO_FACTOR_POLICIES.includes(row?.value as TwoFactorPolicy)
    ? row.value as TwoFactorPolicy
    : "recommended";
  cached = { value, expiresAt: Date.now() + 5_000 };
  return value;
}

export async function setTwoFactorPolicy(
  value: TwoFactorPolicy,
  userId: string,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  if (!TWO_FACTOR_POLICIES.includes(value)) throw new Error("INVALID_TWO_FACTOR_POLICY");
  const settings = await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(platformSecuritySettings)
      .where(eq(platformSecuritySettings.id, "global")).limit(1).for("update");
    if (previous?.twoFactorPolicy === value) return previous;
    const [updated] = await tx.insert(platformSecuritySettings)
      .values({ id: "global", twoFactorPolicy: value, updatedByUserId: userId })
      .onConflictDoUpdate({
        target: platformSecuritySettings.id,
        set: { twoFactorPolicy: value, updatedByUserId: userId, updatedAt: new Date() },
      }).returning();
    await tx.insert(platformAuditLogs).values({
      actorIdentity: "platform-user:" + userId,
      actorUserId: userId,
      action: "platform.security.two_factor_policy.changed",
      resourceType: "platform_security_settings",
      resourceId: "global",
      metadata: { previousPolicy: previous?.twoFactorPolicy || "unset", newPolicy: value },
      ipAddress: context.ipAddress?.slice(0, 64) || null,
      userAgent: context.userAgent?.slice(0, 1024) || null,
    });
    return updated;
  });
  // A failed or rolled-back audit must not publish the new setting in memory.
  cached = { value, expiresAt: Date.now() + 5_000 };
  return settings;
}
