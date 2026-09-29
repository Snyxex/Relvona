import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizationRolePolicies } from "../db/schema.js";

export const ORGANIZATION_PERMISSIONS = [
  "organization.view", "organization.manage", "members.view", "members.manage", "roles.manage",
  "settings.view", "settings.manage", "conversations.view", "conversations.manage",
  "tickets.view", "tickets.manage", "customers.view", "customers.manage",
  "knowledge.view", "knowledge.manage", "assistants.view", "assistants.manage",
  "analytics.view", "analytics.manage", "scheduling.view", "scheduling.manage",
  "tools.view", "tools.manage", "integrations.view", "integrations.manage",
  "notifications.view", "notifications.manage", "storage.manage",
  "visitor_memory.view", "visitor_memory.manage", "webhooks.manage",
] as const;

export type OrganizationPermission = typeof ORGANIZATION_PERMISSIONS[number];
export type ConfigurableOrganizationRole = "admin" | "agent" | "viewer";
export const CONFIGURABLE_ORGANIZATION_ROLES: ConfigurableOrganizationRole[] = ["admin", "agent", "viewer"];

const allPermissions = [...ORGANIZATION_PERMISSIONS];
export const DEFAULT_ROLE_PERMISSIONS: Record<ConfigurableOrganizationRole, OrganizationPermission[]> = {
  admin: allPermissions.filter((permission) => permission !== "roles.manage"),
  agent: [
    "organization.view", "members.view", "settings.view", "conversations.view", "conversations.manage",
    "tickets.view", "tickets.manage", "customers.view", "knowledge.view", "assistants.view",
    "analytics.view", "scheduling.view", "scheduling.manage", "tools.view", "tools.manage",
    "integrations.view", "notifications.view", "notifications.manage", "visitor_memory.view",
  ],
  viewer: [
    "organization.view", "members.view", "settings.view", "conversations.view", "tickets.view",
    "customers.view", "knowledge.view", "assistants.view", "analytics.view", "scheduling.view",
    "tools.view", "integrations.view", "notifications.view", "visitor_memory.view",
  ],
};

export const PERMISSION_CATALOG: Array<{ group: string; permissions: Array<{ id: OrganizationPermission; label: string }> }> = [
  { group: "Organisation", permissions: [
    { id: "organization.view", label: "Organisation ansehen" }, { id: "organization.manage", label: "Organisation verwalten" },
    { id: "members.view", label: "Mitglieder ansehen" }, { id: "members.manage", label: "Mitglieder und Einladungen verwalten" },
    { id: "roles.manage", label: "Rollen und Berechtigungen verwalten" },
    { id: "settings.view", label: "Einstellungen ansehen" }, { id: "settings.manage", label: "Einstellungen ändern" },
  ] },
  { group: "Support", permissions: [
    { id: "conversations.view", label: "Unterhaltungen ansehen" }, { id: "conversations.manage", label: "Unterhaltungen bearbeiten" },
    { id: "tickets.view", label: "Tickets ansehen" }, { id: "tickets.manage", label: "Tickets bearbeiten" },
    { id: "customers.view", label: "Kunden ansehen" }, { id: "customers.manage", label: "Kunden verwalten" },
  ] },
  { group: "KI und Wissen", permissions: [
    { id: "knowledge.view", label: "Wissensdaten ansehen" }, { id: "knowledge.manage", label: "Wissensdaten verwalten" },
    { id: "assistants.view", label: "Assistenten ansehen" }, { id: "assistants.manage", label: "Assistenten verwalten" },
    { id: "analytics.view", label: "Analysen ansehen" }, { id: "analytics.manage", label: "Analysen und Wissenslücken bearbeiten" },
  ] },
  { group: "Automatisierung", permissions: [
    { id: "scheduling.view", label: "Terminplanung ansehen" }, { id: "scheduling.manage", label: "Terminplanung verwalten" },
    { id: "tools.view", label: "Aktionen ansehen" }, { id: "tools.manage", label: "Aktionen ausführen und freigeben" },
    { id: "integrations.view", label: "Integrationen ansehen" }, { id: "integrations.manage", label: "Integrationen verwalten" },
    { id: "webhooks.manage", label: "Webhooks verwalten" },
  ] },
  { group: "Betrieb", permissions: [
    { id: "notifications.view", label: "Benachrichtigungen ansehen" }, { id: "notifications.manage", label: "Benachrichtigungen verwalten" },
    { id: "storage.manage", label: "Speicher verwalten" },
    { id: "visitor_memory.view", label: "Besuchererinnerungen ansehen" }, { id: "visitor_memory.manage", label: "Besuchererinnerungen löschen" },
  ] },
];

const permissionSet = new Set<string>(ORGANIZATION_PERMISSIONS);

export function normalizePermissions(value: unknown): OrganizationPermission[] | null {
  if (!Array.isArray(value) || value.some((permission) => typeof permission !== "string" || !permissionSet.has(permission))) return null;
  return [...new Set(value)] as OrganizationPermission[];
}

export async function permissionsForRole(organizationId: string, role: string): Promise<OrganizationPermission[]> {
  if (role === "owner") return allPermissions;
  if (!CONFIGURABLE_ORGANIZATION_ROLES.includes(role as ConfigurableOrganizationRole)) return [];
  const [policy] = await db.select({ permissions: organizationRolePolicies.permissions })
    .from(organizationRolePolicies)
    .where(and(eq(organizationRolePolicies.organizationId, organizationId), eq(organizationRolePolicies.role, role)))
    .limit(1);
  return normalizePermissions(policy?.permissions) || [...DEFAULT_ROLE_PERMISSIONS[role as ConfigurableOrganizationRole]];
}

export async function policiesForOrganization(organizationId: string) {
  const rows = await db.select({ role: organizationRolePolicies.role, permissions: organizationRolePolicies.permissions })
    .from(organizationRolePolicies)
    .where(eq(organizationRolePolicies.organizationId, organizationId));
  const stored = new Map(rows.map((row) => [row.role, normalizePermissions(row.permissions)]));
  return Object.fromEntries(CONFIGURABLE_ORGANIZATION_ROLES.map((role) => [role, stored.get(role) || [...DEFAULT_ROLE_PERMISSIONS[role]]]));
}
