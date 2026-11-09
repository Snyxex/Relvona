"use client";
import AccessShell from "@/components/access-shell";
import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(
    null,
  );
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    void authClient
      .getSession()
      .then((result) => setHasSession(Boolean(result.data?.user)));
    params
      .then(({ token }) => {
        setToken(token);
        return api.get(`/auth/invitations/${token}`);
      })
      .then((response) => setInvite(response.data))
      .catch((e: unknown) => {
        const responseError = isAxiosError(e)
          ? e.response?.data?.error
          : undefined;
        setError(
          typeof responseError === "string"
            ? responseError
            : "Einladung ungültig.",
        );
      });
  }, [params]);
  const accept = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!invite) return;
    try {
      await api.post(`/auth/invitations/${token}/accept`, { name, password });
      const result = await authClient.signIn.email({
        email: invite.email,
        password,
      });
      if (result.error)
        throw new Error(result.error.message || "Anmeldung fehlgeschlagen.");
      window.location.assign("/");
    } catch (e: unknown) {
      const apiError = isAxiosError(e) ? e.response?.data?.error : undefined;
      setError(
        typeof apiError === "string"
          ? apiError
          : e instanceof Error
            ? e.message
            : "Einladung konnte nicht angenommen werden.",
      );
    }
  };
  const acceptExisting = async () => {
    try {
      await api.post(`/auth/invitations/${token}/accept-existing`);
      window.location.assign("/");
    } catch (e: unknown) {
      const apiError = isAxiosError(e) ? e.response?.data?.error : undefined;
      setError(
        typeof apiError === "string"
          ? apiError
          : "Einladung konnte nicht angenommen werden.",
      );
    }
  };
  return (
    <AccessShell
      title="Einladung annehmen"
      description="Tritt deinem Team bei und starte in deinem Relvona-Arbeitsbereich."
      eyebrow="DEIN TEAM"
    >
      {error ? (
        <p role="alert" className="rv-access-status">
          {error}
        </p>
      ) : !invite ? (
        <p role="status" className="rv-access-status">
          Einladung wird geprüft …
        </p>
      ) : hasSession ? (
        <section className="space-y-4">
          <p className="text-sm text-slate-400">
            Angemeldet als vorhandenes Konto. Die E-Mail-Adresse muss mit{" "}
            {invite.email} übereinstimmen.
          </p>
          <button
            type="button"
            onClick={acceptExisting}
            className="w-full rounded bg-blue-600 p-3"
          >
            Organisation beitreten
          </button>
        </section>
      ) : (
        <form onSubmit={accept} className="space-y-4">
          <p className="text-sm text-slate-400">
            {invite.email} · {invite.role}
          </p>
          <label htmlFor="invite-name" className="rv-access-field">
            Name
            <input
              id="invite-name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full rounded bg-slate-800 p-3"
            />
          </label>
          <label htmlFor="invite-password" className="rv-access-field">
            Passwort
            <input
              id="invite-password"
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
          <button type="submit" className="w-full rounded bg-blue-600 p-3">
            Konto erstellen und beitreten
          </button>
        </form>
      )}
    </AccessShell>
  );
}
