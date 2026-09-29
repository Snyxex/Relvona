import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformSecuritySettings } from "../db/schema.js";

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

export async function setTwoFactorPolicy(value: TwoFactorPolicy, userId: string) {
  const [settings] = await db.insert(platformSecuritySettings)
    .values({ id: "global", twoFactorPolicy: value, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: platformSecuritySettings.id,
      set: { twoFactorPolicy: value, updatedByUserId: userId, updatedAt: new Date() },
    })
    .returning();
  cached = { value, expiresAt: Date.now() + 5_000 };
  return settings;
}
