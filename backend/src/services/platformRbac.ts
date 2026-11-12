import { PLATFORM_ADMIN_ROLE } from "../db/platformRoles.js";

/** Platform roles are independent of tenant roles. Unknown values fail closed. */
export const PLATFORM_ROLES = [PLATFORM_ADMIN_ROLE, "PLATFORM_SUPPORT", "PLATFORM_AUDITOR"] as const;
export type PlatformRole = typeof PLATFORM_ROLES[number];

export const PLATFORM_PERMISSIONS = [
  "platform.overview.view",
  "platform.organizations.view",
  "platform.organizations.manage",
  "platform.users.view",
  "platform.security.view",
  "platform.security.manage",
  "platform.support_sessions.manage",
] as const;
export type PlatformPermission = typeof PLATFORM_PERMISSIONS[number];
export type LimitedPlatformRole = Exclude<PlatformRole, typeof PLATFORM_ADMIN_ROLE>;
export const LIMITED_PLATFORM_ROLES = ["PLATFORM_SUPPORT", "PLATFORM_AUDITOR"] as const;

const ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  PLATFORM_ADMIN: PLATFORM_PERMISSIONS,
  PLATFORM_SUPPORT: [
    "platform.overview.view",
    "platform.organizations.view",
    "platform.support_sessions.manage",
  ],
  PLATFORM_AUDITOR: [
    "platform.overview.view",
    "platform.organizations.view",
    "platform.users.view",
    "platform.security.view",
  ],
};

export function normalizePlatformRole(role: unknown): PlatformRole | null {
  return typeof role === "string" && PLATFORM_ROLES.some((entry) => entry === role)
    ? role as PlatformRole
    : null;
}

export function platformPermissionsForRole(role: unknown): PlatformPermission[] {
  const normalized = normalizePlatformRole(role);
  return normalized ? [...ROLE_PERMISSIONS[normalized]] : [];
}

export function isLimitedPlatformRole(role: unknown): role is LimitedPlatformRole {
  return LIMITED_PLATFORM_ROLES.some((entry) => entry === role);
}
