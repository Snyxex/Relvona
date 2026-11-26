"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Config = {
  organizationId: string;
  redirectUri: string;
  oidc: {
    enabled: boolean;
    label: string;
    issuer: string;
    clientId: string;
    allowedDomains: string[];
    secretConfigured: boolean;
    clientSecret?: string;
  };
  ldap: {
    enabled: boolean;
    directoryType: string;
    url: string;
    baseDn: string;
    bindDn: string;
    passwordConfigured: boolean;
    password?: string;
  };
};
export default function AuthenticationPage() {
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const { data } = await api.get("/admin/settings/federation");
    setConfig({
      ...data,
      oidc: { ...data.oidc, clientSecret: "" },
      ldap: { ...data.ldap, password: "" },
    });
  }, []);
  useEffect(() => {
    void load().catch(() =>
      setError("Anmeldeeinstellungen konnten nicht geladen werden."),
    );
  }, [load]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.put("/admin/settings/federation", config);
      await load();
      setNotice("Anmeldeeinstellungen gespeichert.");
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error || "Speichern fehlgeschlagen.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!config)
    return (
      <main>
        <h1>Anmeldung & SSO</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Einstellungen werden geladen …"}
        </p>
      </main>
    );
  const c = config;
  function oidc(key: string, value: unknown) {
    setConfig({ ...c, oidc: { ...c.oidc, [key]: value } });
  }
  function ldap(key: string, value: unknown) {
    setConfig({ ...c, ldap: { ...c.ldap, [key]: value } });
  }
  return (
    <main className="space-y-6">
      <header>
        <h1>Anmeldung & SSO</h1>
        <p>
          Authentik, Keycloak und andere OpenID-Connect-Anbieter oder ein
          LDAP-Verzeichnis verbinden.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={save} className="space-y-6">
        <section className="rounded-xl border bg-card p-6 space-y-4">
          <h2 className="font-semibold">OpenID Connect</h2>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.oidc.enabled}
              onChange={(e) => oidc("enabled", e.target.checked)}
            />
            SSO aktivieren
          </label>
          <p className="text-sm text-muted-foreground">
            Benutzer benötigen eine bestehende Mitgliedschaft oder Einladung.
            Der Anbieter muss eine bestätigte E-Mail-Adresse liefern. Lokale
            Zwei-Faktor-Authentifizierung bleibt wirksam.
          </p>
          {(["label", "issuer", "clientId", "clientSecret"] as const).map(
            (key, i) => (
              <label key={key} className="block space-y-1">
                <span>
                  {
                    ["Anzeigename", "Issuer-URL", "Client-ID", "Client-Secret"][
                      i
                    ]
                  }
                </span>
                <input
                  className="w-full"
                  type={key === "clientSecret" ? "password" : "text"}
                  autoComplete="off"
                  required={c.oidc.enabled && key !== "clientSecret"}
                  value={c.oidc[key] || ""}
                  placeholder={
                    key === "issuer"
                      ? "https://auth.example.com/application/o/relvona/"
                      : key === "clientSecret" && c.oidc.secretConfigured
                        ? "Gespeichert – leer lassen zum Beibehalten"
                        : ""
                  }
                  onChange={(e) => oidc(key, e.target.value)}
                />
              </label>
            ),
          )}
          <label className="block space-y-1">
            <span>Zugelassene E-Mail-Domains (kommagetrennt)</span>
            <input
              className="w-full"
              value={c.oidc.allowedDomains.join(", ")}
              onChange={(e) =>
                oidc(
                  "allowedDomains",
                  e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                )
              }
              placeholder="example.com"
            />
          </label>
          <p className="text-sm">
            Redirect-URI beim Anbieter exakt hinterlegen:
          </p>
          <code className="block break-all">{c.redirectUri}</code>
          <p className="text-sm text-muted-foreground">
            Authentik: vertraulicher OAuth2/OpenID-Connect-Client, Authorization
            Code mit PKCE S256, Scopes openid, profile und email; Signatur mit
            RS256, PS256 oder ES256. Client-Authentifizierung über
            client_secret_post.
          </p>
        </section>
        <section className="rounded-xl border bg-card p-6 space-y-4">
          <h2 className="font-semibold">LDAP / Active Directory</h2>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.ldap.enabled}
              onChange={(e) => ldap("enabled", e.target.checked)}
            />
            Verzeichnisanmeldung aktivieren
          </label>
          <label className="block space-y-1">
            <span>Verzeichnistyp</span>
            <select
              className="w-full"
              value={c.ldap.directoryType}
              onChange={(e) => ldap("directoryType", e.target.value)}
            >
              <option value="ad">Active Directory</option>
              <option value="ldap">LDAP (inetOrgPerson, uid / mail)</option>
            </select>
          </label>
          {(["url", "baseDn", "bindDn", "password"] as const).map((key, i) => (
            <label key={key} className="block space-y-1">
              <span>
                {
                  [
                    "LDAPS-URL (Port 636)",
                    "Base DN",
                    "Bind DN",
                    "Bind-Passwort",
                  ][i]
                }
              </span>
              <input
                className="w-full"
                autoComplete="off"
                type={key === "password" ? "password" : "text"}
                required={c.ldap.enabled && key !== "password"}
                value={c.ldap[key] || ""}
                placeholder={
                  key === "password" && c.ldap.passwordConfigured
                    ? "Gespeichert – leer lassen zum Beibehalten"
                    : ""
                }
                onChange={(e) => ldap(key, e.target.value)}
              />
            </label>
          ))}
          <p className="text-sm text-muted-foreground">
            TLS-Zertifikate werden geprüft. LDAP setzt ein aktives Relvona-Konto
            mit Organisationsmitgliedschaft voraus. Die E-Mail-Adresse muss im
            Verzeichnis über mail oder den Benutzerprinzipal auffindbar sein.
          </p>
        </section>
        <section className="rounded-xl border bg-card p-6 space-y-3">
          <h2 className="font-semibold">Anmeldung für diese Organisation</h2>
          <p className="text-sm">
            Diese Organisationskennung im Login unter „Firmenkonto“ verwenden:
          </p>
          <code className="block break-all">{c.organizationId}</code>
        </section>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Speichert …" : "Anmeldeeinstellungen speichern"}
        </button>
      </form>
    </main>
  );
}
