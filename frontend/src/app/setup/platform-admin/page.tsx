"use client";
import { useEffect, useState } from "react";
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
      await api.post("/auth/setup/platform-admin", {
        name,
        organizationName,
        email,
        password,
        passwordConfirmation: confirmation,
      });
      const result = await authClient.signIn.email({ email, password });
      if (result.error)
        throw new Error(result.error.message || "Anmeldung fehlgeschlagen.");
      window.location.assign("/");
    } catch (e: any) {
      const responseError = e.response?.data?.error;
      setError(
        typeof responseError === "string"
          ? responseError
          : responseError?.code === "INTERNAL_ERROR"
            ? "Die Einrichtung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut."
            : responseError?.message || e.message || "Setup fehlgeschlagen.",
      );
    } finally {
      setSaving(false);
    }
  };
  if (!ready)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-white">
        Einrichtung wird geprüft …
      </main>
    );
  if (blocked)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <div>
          <h1 className="text-2xl font-bold">Setup abgeschlossen</h1>
          <a className="mt-4 block text-blue-300" href="/">
            Zur Anmeldung
          </a>
        </div>
      </main>
    );
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-8"
      >
        <h1 className="text-2xl font-bold">Relvona einrichten</h1>
        <p className="text-sm text-slate-400">
          Erstellen Sie Ihre Organisation und das erste Owner-Konto.
        </p>
        {error && (
          <p
            role="alert"
            className="rounded bg-red-950 p-3 text-sm text-red-200"
          >
            {error}
          </p>
        )}
        <input
          required
          minLength={2}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full rounded bg-slate-800 p-3"
        />
        <input
          required
          minLength={2}
          maxLength={120}
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          placeholder="Organisation"
          className="w-full rounded bg-slate-800 p-3"
        />
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-Mail"
          className="w-full rounded bg-slate-800 p-3"
        />
        <input
          required
          minLength={12}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          className="w-full rounded bg-slate-800 p-3"
        />
        <input
          required
          minLength={12}
          type="password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder="Passwort bestätigen"
          className="w-full rounded bg-slate-800 p-3"
        />
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded bg-blue-600 p-3 font-semibold disabled:opacity-50"
        >
          {saving ? "Wird eingerichtet …" : "Organisation und Owner erstellen"}
        </button>
      </form>
    </main>
  );
}
