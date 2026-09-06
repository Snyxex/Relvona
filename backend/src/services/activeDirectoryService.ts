import { Client, escapeFilter } from "ldapts";
import { logger } from "../observability/logger.js";
import { decryptSecret } from "../utils/crypto.js";

export type ActiveDirectorySettings = {
  activeDirectoryEnabled: boolean;
  activeDirectoryUrl: string | null;
  activeDirectoryBaseDn: string | null;
  activeDirectoryBindDn: string | null;
  activeDirectoryBindPasswordEncrypted: string | null;
};

export function isValidActiveDirectoryUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 300) return false;
  try {
    const url = new URL(value);
    return url.protocol === "ldaps:" && Boolean(url.hostname) && !url.username && !url.password && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash && (!url.port || url.port === "636");
  } catch { return false; }
}

export function isValidDistinguishedName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 2 && value.length <= 500 && /(^|,)[A-Za-z][A-Za-z0-9-]*=/.test(value);
}

/** Performs a service-account search followed by a user bind. Passwords are never logged. */
export class ActiveDirectoryService {
  static async authenticate(settings: ActiveDirectorySettings, username: string, password: string, organizationId: string): Promise<boolean> {
    if (!settings.activeDirectoryEnabled || !isValidActiveDirectoryUrl(settings.activeDirectoryUrl) || !isValidDistinguishedName(settings.activeDirectoryBaseDn) || !isValidDistinguishedName(settings.activeDirectoryBindDn)) return false;
    const bindPassword = decryptSecret(settings.activeDirectoryBindPasswordEncrypted);
    if (!bindPassword) return false;
    const client = new Client({ url: settings.activeDirectoryUrl, timeout: 8_000, connectTimeout: 5_000, tlsOptions: { rejectUnauthorized: true } });
    try {
      await client.bind(settings.activeDirectoryBindDn, bindPassword);
      const result = await client.search(settings.activeDirectoryBaseDn, {
        scope: "sub",
        sizeLimit: 2,
        timeLimit: 5,
        attributes: ["distinguishedName"],
        filter: escapeFilter`(&(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2))(|(userPrincipalName=${username.trim()})(mail=${username.trim()})(sAMAccountName=${username.trim()})))`,
      });
      if (result.searchEntries.length !== 1) return false;
      await client.bind(result.searchEntries[0].dn, password);
      logger.info("active_directory.login_succeeded", { organizationId });
      return true;
    } catch (error) {
      logger.warn("active_directory.login_failed", { organizationId, reason: error instanceof Error ? error.name : "unknown" });
      return false;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  static async verifyConfiguration(settings: ActiveDirectorySettings, organizationId: string): Promise<boolean> {
    if (!isValidActiveDirectoryUrl(settings.activeDirectoryUrl) || !isValidDistinguishedName(settings.activeDirectoryBindDn)) return false;
    const bindPassword = decryptSecret(settings.activeDirectoryBindPasswordEncrypted);
    if (!bindPassword) return false;
    const client = new Client({ url: settings.activeDirectoryUrl, timeout: 8_000, connectTimeout: 5_000, tlsOptions: { rejectUnauthorized: true } });
    try {
      await client.bind(settings.activeDirectoryBindDn, bindPassword);
      logger.info("active_directory.configuration_verified", { organizationId });
      return true;
    } catch (error) {
      logger.warn("active_directory.configuration_failed", { organizationId, reason: error instanceof Error ? error.name : "unknown" });
      return false;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
