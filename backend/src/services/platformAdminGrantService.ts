import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { authSessions, users } from "../db/schema.js";
import { platformRoles, PLATFORM_ADMIN_ROLE } from "../db/platformRoles.js";

/**
 * Operator-only CLI workflow. Do not expose this through an unprotected HTTP route.
 * platform_roles is the sole source of platform authorization.
 */
export async function grantPlatformAdministrator(email: string): Promise<{ userId: string; granted: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254 || !normalizedEmail.includes("@")) {
    throw new Error("Valid existing-user email required");
  }

  return db.transaction(async (tx) => {
    // Serialize repeat/concurrent grants for a single user.
    const [user] = await tx.select({
      id: users.id,
      status: users.status,
      systemRole: users.systemRole,
      tokenVersion: users.tokenVersion,
    }).from(users).where(eq(users.email, normalizedEmail)).limit(1).for("update");
    if (!user) throw new Error("User not found. Create or invite the account first.");
    if (user.status !== "active") throw new Error("Only active accounts can become platform administrators");

    const [existing] = await tx.select({ role: platformRoles.role })
      .from(platformRoles).where(eq(platformRoles.userId, user.id)).limit(1);
    if (existing && existing.role !== PLATFORM_ADMIN_ROLE) {
      throw new Error("Existing platform role requires manual review");
    }
    if (existing) {
      if (user.systemRole !== "user") {
        await tx.update(users).set({ systemRole: "user", updatedAt: new Date() }).where(eq(users.id, user.id));
      }
      return { userId: user.id, granted: false };
    }

    await tx.insert(platformRoles).values({ userId: user.id, role: PLATFORM_ADMIN_ROLE });
    await tx.update(users).set({
      systemRole: "user",
      tokenVersion: user.tokenVersion + 1,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));
    // Pre-grant Better Auth sessions must not survive a privilege change.
    await tx.delete(authSessions).where(eq(authSessions.userId, user.id));
    return { userId: user.id, granted: true };
  });
}
