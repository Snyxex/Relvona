"use client";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/api";

export default function FederationLogin({
  onTwoFactor,
}: {
  onTwoFactor: () => void;
}) {
  const [organization, setOrganization] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("federation_mfa") === "1") {
      params.delete("federation_mfa");
      window.history.replaceState(
        null,
        "",
        window.location.pathname + "?" + params.toString(),
      );
      onTwoFactor();
    }
    const org = params.get("organization");
    if (org && /^[0-9a-f-]{36}$/i.test(org)) {
      setOrganization(org);
      localStorage.setItem("active_org_id", org);
    }
    if (window.location.hash.startsWith("#sso_error=")) {
      setError(
        "SSO-Anmeldung fehlgeschlagen. Anbieter, Einladung und E-Mail-Bestätigung prüfen.",
      );
    }
  }, [onTwoFactor]);
  const valid = /^[0-9a-f-]{36}$/i.test(organization);
  const authBase = API_BASE_URL.replace(/\/api\/v1\/?$/, "") + "/api/auth";
  async function login() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(authBase + "/ldap/sign-in", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error || "Anmeldung fehlgeschlagen.");
      localStorage.setItem("active_org_id", organization);
      setPassword("");
      if (data.twoFactorRedirect) {
        onTwoFactor();
      } else {
        window.location.assign("/");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      open={error ? true : undefined}
      className="mt-5 border-t border-slate-700 pt-4"
    >
      <summary className="cursor-pointer text-sm font-medium">
        Mit Firmenkonto anmelden (SSO / LDAP)
      </summary>
      <div className="mt-4 space-y-3">
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <label className="block text-xs">
          Organisationskennung
          <input
            className="mt-1 w-full rounded border bg-slate-800 p-2 text-sm"
            value={organization}
            onChange={(e) => setOrganization(e.target.value.trim())}
            placeholder="UUID von deinem Administrator"
          />
        </label>
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            localStorage.setItem("active_org_id", organization);
            window.location.assign(
              authBase + "/oidc/" + encodeURIComponent(organization) + "/start",
            );
          }}
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Mit SSO-Anbieter fortfahren
        </button>
        <p className="text-xs text-slate-400">Für LDAP / Active Directory:</p>
        <label className="block text-xs">
          Firmen-E-Mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border bg-slate-800 p-2 text-sm"
          />
        </label>
        <label className="block text-xs">
          Verzeichnispasswort
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border bg-slate-800 p-2 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={busy || !valid || !email || !password}
          onClick={() => void login()}
          className="w-full rounded border px-3 py-2 text-sm disabled:opacity-50"
        >
          {busy ? "Anmeldung läuft …" : "Mit LDAP anmelden"}
        </button>
      </div>
    </details>
  );
}
