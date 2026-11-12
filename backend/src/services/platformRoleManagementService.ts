import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformRoles } from "../db/platformRoles.js";
import { authSessions, users } from "../db/schema.js";
import { isLimitedPlatformRole, type LimitedPlatformRole } from "./platformRbac.js";

/**
 * Operator-only DB/CLI workflow. Never expose through a public or tenant API.
 * Full administrator grants have their own separate procedure.
 */
export async function grantLimitedPlatformRole(
  email: string, requestedRole: LimitedPlatformRole,
): Promise<{ userId: string; changed: boolean }> {
  if (!isLimitedPlatformRole(requestedRole)) throw new Error("INVALID_LIMITED_PLATFORM_ROLE");
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254 || !normalizedEmail.includes("@")) throw new Error("Invalid email");

  return db.transaction(async (tx) => {
    const [user] = await tx.select({
      id: users.id, status: users.status, tokenVersion: users.tokenVersion,
    }).from(users).where(eq(users.email, normalizedEmail)).limit(1).for("update");
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.status !== "active") throw new Error("USER_NOT_ACTIVE");

    const [existing] = await tx.select({ role: platformRoles.role })
      .from(platformRoles).where(eq(platformRoles.userId, user.id)).limit(1);
    if (existing) {
      if (existing.role !== requestedRole) throw new Error("PLATFORM_ROLE_CONFLICT_REQUIRES_REVIEW");
      return { userId: user.id, changed: false };
    }

    await tx.insert(platformRoles).values({ userId: user.id, role: requestedRole });
    await tx.update(users).set({
      systemRole: "user", tokenVersion: user.tokenVersion + 1, updatedAt: new Date(),
    }).where(eq(users.id, user.id));
    await tx.delete(authSessions).where(eq(authSessions.userId, user.id));
    return { userId: user.id, changed: true };
  });
}

export async function revokeLimitedPlatformRole(email: string): Promise<{ userId: string; changed: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254 || !normalizedEmail.includes("@")) throw new Error("Invalid email");
  return db.transaction(async (tx) => {
    const [user] = await tx.select({
      id: users.id, tokenVersion: users.tokenVersion,
    }).from(users).where(eq(users.email, normalizedEmail)).limit(1).for("update");
    if (!user) throw new Error("USER_NOT_FOUND");
    const [existing] = await tx.select({ role: platformRoles.role })
      .from(platformRoles).where(eq(platformRoles.userId, user.id)).limit(1);
    if (!existing) return { userId: user.id, changed: false };
    if (!isLimitedPlatformRole(existing.role)) throw new Error("REFUSE_REVOKE_PLATFORM_ADMIN");

    await tx.delete(platformRoles).where(and(
      eq(platformRoles.userId, user.id), eq(platformRoles.role, existing.role),
    ));
    await tx.update(users).set({
      systemRole: "user", tokenVersion: user.tokenVersion + 1, updatedAt: new Date(),
    }).where(eq(users.id, user.id));
    await tx.delete(authSessions).where(eq(authSessions.userId, user.id));
    return { userId: user.id, changed: true };
  });
}
