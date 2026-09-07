import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./betterAuth.js";
import { db } from "../db/index.js";
import { users, organizationMembers, organizations } from "../db/schema.js";
import { platformRoles, PLATFORM_ADMIN_ROLE } from "../db/platformRoles.js";
import { and, eq } from "drizzle-orm";

export type AuthenticatedUser = { id: string; email: string; name: string; avatarUrl: string | null; preferredLanguage: string; isPlatformAdmin: boolean; systemRole: "superadmin" | "user"; status: string };
export const ORGANIZATION_ROLES = ["owner", "admin", "agent", "viewer"] as const;
export type OrganizationRole = typeof ORGANIZATION_ROLES[number];
export type OrganizationMembership = { id: string; name: string; slug: string; role: OrganizationRole };

export async function getSession(request: Pick<Request, "headers">) {
  return auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
    query: { disableCookieCache: true },
  });
}

export async function isPlatformAdmin(userId: string) {
  const [role] = await db.select({ id: platformRoles.id }).from(platformRoles)
    .where(and(eq(platformRoles.userId, userId), eq(platformRoles.role, PLATFORM_ADMIN_ROLE)))
    .limit(1);
  return Boolean(role);
}

export async function getCurrentUser(request: Pick<Request, "headers">): Promise<AuthenticatedUser | null> {
  const session = await getSession(request);
  if (!session?.user?.id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user || user.status !== "active") return null;
  const platformAdmin = await isPlatformAdmin(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    preferredLanguage: user.preferredLanguage,
    isPlatformAdmin: platformAdmin,
    // Temporary response compatibility only. Authorization never reads users.system_role.
    systemRole: platformAdmin ? "superadmin" : "user",
    status: user.status,
  };
}

export async function getOrganizationMembership(userId: string, organizationId: string): Promise<OrganizationMembership | null> {
  const [membership] = await db.select({
    id: organizations.id,
    name: organizations.name,
    slug: organizations.slug,
    role: organizationMembers.role,
    organizationStatus: organizations.status,
    membershipStatus: organizationMembers.status,
  }).from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .limit(1);
  if (!membership || membership.organizationStatus !== "active" || membership.membershipStatus !== "active" || !ORGANIZATION_ROLES.includes(membership.role as OrganizationRole)) return null;
  return { id: membership.id, name: membership.name, slug: membership.slug, role: membership.role as OrganizationRole };
}

export function hasOrganizationRole(membership: OrganizationMembership, roles: readonly OrganizationRole[]) {
  return roles.includes(membership.role);
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required" });
    (request as Request & { user?: AuthenticatedUser }).user = user;
    next();
  } catch { return response.status(401).json({ error: "Authentication required" }); }
}
