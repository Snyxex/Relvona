import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLogs, organizationSettings } from "../db/schema.js";
import type { AuthRequest } from "../middleware/auth.js";
import { encryptSecret } from "../utils/crypto.js";
import { validateOidcConfiguration } from "../auth/oidcPolicy.js";
import {
  isValidActiveDirectoryUrl,
  isValidDistinguishedName,
} from "../services/activeDirectoryService.js";

// Mounted only after admin session, tenant RBAC, rate limit and IP checks.
export function federationSettings(
  settingsFor: (
    id: string,
  ) => Promise<typeof organizationSettings.$inferSelect>,
) {
  const router = Router();
  // Dedicated projection: never return provider credentials to the browser.
  router.get("/settings/federation", async (req: AuthRequest, res) => {
    const settings = await settingsFor(req.organization!.id);
    const config = settings.oidcConfiguration as Record<string, unknown> | null;
    res.json({
      organizationId: req.organization!.id,
      oidc: config
        ? {
            enabled: config.enabled,
            label: config.label,
            issuer: config.issuer,
            clientId: config.clientId,
            allowedDomains: config.allowedDomains,
            secretConfigured: Boolean(config.clientSecretEncrypted),
          }
        : {
            enabled: false,
            label: "Authentik",
            issuer: "",
            clientId: "",
            allowedDomains: [],
            secretConfigured: false,
          },
      ldap: {
        enabled: settings.activeDirectoryEnabled,
        directoryType: settings.ldapDirectoryType,
        url: settings.activeDirectoryUrl || "",
        baseDn: settings.activeDirectoryBaseDn || "",
        bindDn: settings.activeDirectoryBindDn || "",
        passwordConfigured: Boolean(
          settings.activeDirectoryBindPasswordEncrypted,
        ),
      },
      redirectUri:
        (
          process.env.BETTER_AUTH_URL ||
          process.env.APP_PUBLIC_URL ||
          "http://localhost:8080"
        ).replace(/\/$/, "") + "/api/auth/oidc/callback",
    });
  });
  router.put("/settings/federation", async (req: AuthRequest, res) => {
    try {
      const current = await settingsFor(req.organization!.id),
        body = req.body;
      const old = current.oidcConfiguration as {
        clientSecretEncrypted?: string;
      } | null;
      const oidc = validateOidcConfiguration(body.oidc);
      if (
        typeof body.oidc.clientSecret !== "string" ||
        body.oidc.clientSecret.length > 4096
      )
        throw Error("Ungültiges Client-Secret");
      const encrypted = body.oidc.clientSecret
        ? encryptSecret(body.oidc.clientSecret)
        : old?.clientSecretEncrypted;
      if (oidc.enabled && !encrypted) throw Error("Client-Secret erforderlich");
      const ldap = body.ldap;
      if (
        !ldap ||
        typeof ldap.enabled !== "boolean" ||
        !["ad", "ldap"].includes(ldap.directoryType) ||
        [ldap.url, ldap.baseDn, ldap.bindDn, ldap.password].some(
          (v) => typeof v !== "string",
        ) ||
        ldap.password.length > 4096
      )
        throw Error("Ungültige LDAP-Konfiguration");
      if (
        ldap.enabled &&
        (!isValidActiveDirectoryUrl(ldap.url) ||
          !isValidDistinguishedName(ldap.baseDn) ||
          !isValidDistinguishedName(ldap.bindDn) ||
          !(ldap.password || current.activeDirectoryBindPasswordEncrypted))
      )
        throw Error("LDAPS-URL, Base DN, Bind DN und Passwort erforderlich");
      await db.transaction(async (tx) => {
        await tx
          .update(organizationSettings)
          .set({
            oidcConfiguration: { ...oidc, clientSecretEncrypted: encrypted },
            ldapDirectoryType: ldap.directoryType,
            activeDirectoryEnabled: ldap.enabled,
            activeDirectoryUrl: ldap.url,
            activeDirectoryBaseDn: ldap.baseDn,
            activeDirectoryBindDn: ldap.bindDn,
            activeDirectoryBindPasswordEncrypted: ldap.password
              ? encryptSecret(ldap.password)
              : current.activeDirectoryBindPasswordEncrypted,
            updatedAt: new Date(),
          })
          .where(eq(organizationSettings.id, current.id));
        await tx.insert(auditLogs).values({
          organizationId: req.organization!.id,
          actorUserId: req.user!.id,
          action: "settings.federation.update",
          resourceType: "organization_settings",
          resourceId: current.id,
          metadata: { oidcEnabled: oidc.enabled, ldapEnabled: ldap.enabled },
          ipAddress: req.ip || req.socket.remoteAddress || null,
        });
      });
      res.json({ saved: true });
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Konfiguration ungültig",
      });
    }
  });

  return router;
}
