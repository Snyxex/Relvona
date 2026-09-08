"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, API_BASE_URL } from "@/lib/api";

type Connection = { id: string; provider: string; name: string; enabled: boolean; status: string };
type Setup = {
  connectionId: string;
  enabled: boolean;
  signingSecretConfigured: boolean;
  callbackPath: string;
  payloadTemplate: Record<string, unknown>;
};

export default function ZendeskInboundSetupPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadConnections() {
    setError("");
    try {
      const { data } = await api.get("/integrations");
      const zendesk = (data as Connection[]).filter((connection) => connection.provider === "zendesk");
      setConnections(zendesk);
      setSelected((current) => current || zendesk[0]?.id || "");
    } catch (e: any) {
      setError(e.response?.data?.error || "Zendesk-Verbindungen konnten nicht geladen werden.");
    }
  }

  async function loadSetup(id: string) {
    if (!id) { setSetup(null); return; }
    setError("");
    try {
      const { data } = await api.get(`/integrations/${id}/zendesk-webhook-setup`);
      setSetup(data);
    } catch (e: any) {
      setSetup(null);
      setError(e.response?.data?.error || "Webhook-Setup konnte nicht geladen werden.");
    }
  }

  useEffect(() => { void loadConnections(); }, []);
  useEffect(() => { void loadSetup(selected); }, [selected]);

  const callbackUrl = useMemo(() => {
    if (!setup?.callbackPath) return "";
    try { return new URL(setup.callbackPath, API_BASE_URL).toString(); }
    catch { return setup.callbackPath; }
  }, [setup]);

  async function saveSecret(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setError("");
    try {
      await api.post(`/integrations/${selected}/zendesk-webhook-secret`, { secret });
      setSecret("");
      await loadSetup(selected);
    } catch (e: any) {
      setError(e.response?.data?.error || "Signing Secret konnte nicht gespeichert werden.");
    } finally { setSaving(false); }
  }

  return <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
    <div>
      <p className="text-sm text-muted-foreground">Integrationen · Zendesk</p>
      <h1 className="text-2xl font-semibold">Eingehende Zendesk-Updates</h1>
      <p className="mt-2 text-sm text-muted-foreground">Status und Priorität eines bereits verknüpften Zendesk-Tickets sicher zurück in SupportAI synchronisieren. Signaturprüfung, Replay-Schutz und Deduplizierung sind serverseitig aktiv.</p>
    </div>

    {error && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}

    <section className="rounded-xl border bg-card p-5">
      <label className="text-sm font-medium">Zendesk-Verbindung</label>
      <select value={selected} onChange={(event) => setSelected(event.target.value)} className="mt-2 w-full rounded-lg border bg-background px-3 py-2">
        <option value="">Verbindung wählen</option>
        {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name} · {connection.enabled ? "aktiv" : "pausiert"}</option>)}
      </select>
      {!connections.length && <p className="mt-3 text-sm text-muted-foreground">Zuerst unter „Integrationen“ eine Zendesk-Verbindung anlegen.</p>}
    </section>

    {setup && <>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">1. Signing Secret</h2>
        <p className="mt-1 text-sm text-muted-foreground">Status: {setup.signingSecretConfigured ? "konfiguriert" : "noch nicht konfiguriert"}. Das Secret wird verschlüsselt gespeichert und kann nicht wieder ausgelesen werden.</p>
        <form onSubmit={saveSecret} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input required minLength={16} maxLength={512} type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Zendesk Webhook Signing Secret" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" />
          <button disabled={saving} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{saving ? "Speichert…" : setup.signingSecretConfigured ? "Secret rotieren" : "Secret speichern"}</button>
        </form>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">2. Zendesk Webhook URL</h2>
        <p className="mt-1 text-sm text-muted-foreground">Diese HTTPS-URL als Ziel des Zendesk-Webhooks hinterlegen. Die Verbindung muss in SupportAI aktiv sein.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-background p-3 text-xs">{callbackUrl}</pre>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">3. Request Body in Zendesk</h2>
        <p className="mt-1 text-sm text-muted-foreground">V1 übernimmt ausschließlich Status und Priorität. Unbekannte oder nicht verknüpfte Ticket-IDs werden ignoriert und erzeugen kein lokales Ticket.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-background p-3 text-xs">{JSON.stringify(setup.payloadTemplate, null, 2)}</pre>
      </section>

      <section className="rounded-xl border bg-card p-5 text-sm">
        <h2 className="font-semibold">Sicherheitsverhalten</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Zendesk HMAC-SHA256 Signatur wird gegen den unveränderten Raw Body geprüft.</li>
          <li>Requests außerhalb des konfigurierten Replay-Fensters werden abgelehnt.</li>
          <li>Die Zendesk Invocation-ID wird persistent dedupliziert.</li>
          <li>Inbound-Änderungen werden mit Quelle „zendesk“ markiert und nicht wieder outbound gespiegelt.</li>
          <li>Eingehende Kommentare werden noch nicht importiert, damit externe Autoren nicht mit internen Mitarbeitern vermischt werden.</li>
        </ul>
      </section>
    </>}
  </main>;
}
