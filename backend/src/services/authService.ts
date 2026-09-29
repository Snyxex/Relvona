import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { authAccounts, organizationMembers, organizationSettings, organizations, users } from "../db/schema.js";
import { hashPassword, LEGACY_PASSWORD_SENTINEL } from "../auth/password.js";
import { platformRoles, PLATFORM_ADMIN_ROLE } from "../db/platformRoles.js";

export class AuthService {
  static async platformBootstrapRequired() {
    const [role] = await db.select({ id: platformRoles.id }).from(platformRoles).where(eq(platformRoles.role, PLATFORM_ADMIN_ROLE)).limit(1);
    return !role;
  }

  static async bootstrapPlatformAdmin(data: { name: string; email: string; password: string; organizationName: string }) {
    return db.transaction(async (tx) => {
      // PostgreSQL advisory locking is intentionally the only raw statement in
      // this flow. It serializes the one-time bootstrap across all instances.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(724019)`);

      const [platformAdmin] = await tx.select({ id: platformRoles.id }).from(platformRoles).where(eq(platformRoles.role, PLATFORM_ADMIN_ROLE)).limit(1);
      if (platformAdmin) throw new Error("PLATFORM_ADMIN_ALREADY_EXISTS");

      const email = data.email.toLowerCase().trim();
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new Error("Email address already registered");

      const credentialHash = await hashPassword(data.password);
      const [user] = await tx.insert(users).values({
        name: data.name.trim(),
        email,
        passwordHash: LEGACY_PASSWORD_SENTINEL,
        emailVerified: true,
        systemRole: "user",
      }).returning({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        preferredLanguage: users.preferredLanguage,
      });

      await tx.insert(authAccounts).values({
        id: crypto.randomUUID(),
        accountId: user.id,
        providerId: "credential",
        issuer: "local:credential",
        userId: user.id,
        password: credentialHash,
      });

      const slugBase = data.organizationName
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "organization";
      const [organization] = await tx.insert(organizations).values({
        name: data.organizationName.trim(),
        slug: `${slugBase}-${crypto.randomBytes(3).toString("hex")}`,
      }).returning({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      });

      await tx.insert(organizationMembers).values({
        organizationId: organization.id,
        userId: user.id,
        role: "owner",
      });

      // organization_settings is protected by forced tenant RLS. Scope the
      // remaining transaction to the organization that was just created.
      await tx.execute(sql`SELECT set_config('app.organization_id', ${organization.id}, true)`);
      await tx.insert(organizationSettings).values({ organizationId: organization.id });
      await tx.insert(platformRoles).values({ userId: user.id, role: PLATFORM_ADMIN_ROLE });

      return {
        user: {
          ...user,
          isPlatformAdmin: true,
          systemRole: "superadmin" as const,
        },
        organizations: [{ ...organization, role: "owner" as const }],
      };
    });
  }
}
