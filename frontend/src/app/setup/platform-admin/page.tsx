"use client";
import AccessShell from "@/components/access-shell";
import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export default function PlatformAdminSetupPage() {
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api
      .get("/auth/bootstrap-status")
      .then((res) => {
        setBlocked(!res.data.required);
        setReady(true);
      })
      .catch(() => {
        setError("Setup-Status konnte nicht geladen werden.");
        setReady(true);
      });
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password !== confirmation)
      return setError("Passwörter stimmen nicht überein.");
    setSaving(true);
    try {
      await api.post(
        "/auth/setup/platform-admin",
        {
          name,
          organizationName,
          email,
          password,
          passwordConfirmation: confirmation,
        },
        {
          headers: bootstrapToken
            ? { "X-Platform-Bootstrap-Token": bootstrapToken }
            : {},
        },
      );
      const result = await authClient.signIn.email({ email, password });
      if (result.error)
        throw new Error(result.error.message || "Anmeldung fehlgeschlagen.");
      window.location.assign("/");
    } catch (e: unknown) {
      const responseError = isAxiosError(e)
        ? e.response?.data?.error
        : undefined;
      setError(
        typeof responseError === "string"
          ? responseError
          : responseError?.code === "INTERNAL_ERROR"
            ? "Die Einrichtung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut."
            : typeof responseError?.message === "string"
              ? responseError.message
              : e instanceof Error
                ? e.message
                : "Setup fehlgeschlagen.",
      );
    } finally {
      setSaving(false);
    }
  };
  if (!ready)
    return (
      <AccessShell
        title="Einrichtung wird vorbereitet"
        description="Der aktuelle Einrichtungsstatus wird geprüft."
      >
        <p role="status" className="rv-access-status">
          Einrichtung wird geprüft …
        </p>
      </AccessShell>
    );
  if (blocked)
    return (
      <AccessShell
        title="Setup abgeschlossen"
        description="Relvona ist bereits eingerichtet. Melde dich mit deinem Konto an."
      >
        <div>
          <a className="mt-4 block text-blue-300" href="/">
            Zur Anmeldung
          </a>
        </div>
      </AccessShell>
    );
  return (
    <AccessShell
      title="Relvona einrichten"
      description="Erstelle deine Organisation und das erste Owner-Konto."
      eyebrow="ERSTE SCHRITTE"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded bg-red-950 p-3 text-sm text-red-200"
          >
            {error}
          </p>
        )}
        <label className="block text-sm text-slate-300">
          Setup-Token (aus der Serverkonfiguration)
          <input
            type="password"
            autoComplete="off"
            value={bootstrapToken}
            onChange={(event) => setBootstrapToken(event.target.value)}
            placeholder="PLATFORM_BOOTSTRAP_TOKEN"
            className="mt-2 w-full rounded bg-slate-800 p-3"
          />
        </label>
        <label htmlFor="setup-name" className="rv-access-field">
          Name
          <input
            id="setup-name"
            autoComplete="name"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="w-full rounded bg-slate-800 p-3"
          />
        </label>
        <label htmlFor="setup-organization" className="rv-access-field">
          Organisation
          <input
            id="setup-organization"
            autoComplete="organization"
            required
            minLength={2}
            maxLength={120}
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            placeholder="Organisation"
            className="w-full rounded bg-slate-800 p-3"
          />
        </label>
        <label htmlFor="setup-email" className="rv-access-field">
          E-Mail
          <input
            id="setup-email"
            autoComplete="email"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-Mail"
            className="w-full rounded bg-slate-800 p-3"
          />
        </label>
        <label htmlFor="setup-password" className="rv-access-field">
          Passwort
          <input
            id="setup-password"
            autoComplete="new-password"
            required
            minLength={15}
            maxLength={128}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passwort"
            className="w-full rounded bg-slate-800 p-3"
          />
        </label>
        <label htmlFor="setup-confirmation" className="rv-access-field">
          Passwort bestätigen
          <input
            id="setup-confirmation"
            autoComplete="new-password"
            required
            minLength={15}
            maxLength={128}
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="Passwort bestätigen"
            className="w-full rounded bg-slate-800 p-3"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded bg-blue-600 p-3 font-semibold disabled:opacity-50"
        >
          {saving ? "Wird eingerichtet …" : "Organisation und Owner erstellen"}
        </button>
      </form>
    </AccessShell>
  );
}
