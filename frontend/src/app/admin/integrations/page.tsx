"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Subscription = { id: string; name: string; url: string; eventTypes: string[]; enabled: boolean; createdAt: string };
type Delivery = {
  delivery: { id: string; status: string; attempts: number; responseStatus?: number | null; lastError?: string | null; deliveredAt?: string | null; createdAt: string };
  eventType: string;
  occurredAt: string;
};
type Connection = {
  id: string;
  provider: "hubspot" | "zendesk";
  name: string;
  config: { subdomain?: string; email?: string };
  enabled: boolean;
  status: string;
  credentialsConfigured: boolean;
  lastTestedAt?: string | null;
  lastError?: string | null;
};
type SyncRule = { id: string; connectionId: string; eventType: string; action: string; enabled: boolean; createdAt: string };
type SyncExecution = { id: string; ruleId: string; eventKey: string; entityId: string; status: string; externalId?: string | null; error?: string | null; createdAt: string; updatedAt: string };

export default function AdminIntegrationsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [syncRules, setSyncRules] = useState<SyncRule[]>([]);
  const [syncExecutions, setSyncExecutions] = useState<SyncExecution[]>([]);
  const [syncConnectionId, setSyncConnectionId] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["ticket.created"]);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deliverySubscription, setDeliverySubscription] = useState<Subscription | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [provider, setProvider] = useState<"hubspot" | "zendesk">("hubspot");
  const [integrationName, setIntegrationName] = useState("");
  const [providerToken, setProviderToken] = useState("");
  const [zendeskSubdomain, setZendeskSubdomain] = useState("");
  const [zendeskEmail, setZendeskEmail] = useState("");
  const [integrationLoading, setIntegrationLoading] = useState(false);

  async function load() {
    setError("");
    try {
      const [subscriptionsResult, eventsResult, connectionsResult, rulesResult, executionsResult] = await Promise.all([
        api.get("/webhooks"), api.get("/webhooks/event-types"), api.get("/integrations"), api.get("/integrations/sync/rules"), api.get("/integrations/sync/executions"),
      ]);
      setSubscriptions(subscriptionsResult.data);
      setEventTypes(eventsResult.data);
      setConnections(connectionsResult.data);
      setSyncRules(rulesResult.data);
      setSyncExecutions(executionsResult.data);
      const zendeskConnections = (connectionsResult.data as Connection[]).filter((connection) => connection.provider === "zendesk");
      if (!syncConnectionId && zendeskConnections[0]) setSyncConnectionId(zendeskConnections[0].id);
    } catch (e: any) { setError(e.response?.data?.error || "Integrationen konnten nicht geladen werden."); }
  }
  useEffect(() => { void load(); }, []);

  async function createIntegration(event: FormEvent) {
    event.preventDefault(); setIntegrationLoading(true); setError("");
    try {
      const config = provider === "zendesk" ? { subdomain: zendeskSubdomain, email: zendeskEmail } : {};
      const credentials = provider === "hubspot" ? { accessToken: providerToken } : { apiToken: providerToken };
      const { data } = await api.post("/integrations", { provider, name: integrationName, config, credentials });
      setProviderToken(""); setIntegrationName(""); setZendeskSubdomain(""); setZendeskEmail("");
      await load();
      try { await api.post(`/integrations/${data.id}/test`); await load(); } catch { /* status is stored by backend */ }
    } catch (e: any) { setError(e.response?.data?.error || "Integration konnte nicht erstellt werden."); }
    finally { setIntegrationLoading(false); }
  }

  async function testIntegration(connection: Connection) {
    setIntegrationLoading(true); setError("");
    try { await api.post(`/integrations/${connection.id}/test`); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Verbindungstest fehlgeschlagen."); await load(); }
    finally { setIntegrationLoading(false); }
  }

  async function toggleIntegration(connection: Connection) {
    try { await api.patch(`/integrations/${connection.id}`, { enabled: !connection.enabled }); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Integration konnte nicht aktualisiert werden."); }
  }

  async function removeIntegration(connection: Connection) {
    if (!window.confirm(`Integration „${connection.name}“ wirklich löschen?`)) return;
    try { await api.delete(`/integrations/${connection.id}`); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Integration konnte nicht gelöscht werden."); }
  }

  async function createSyncRule() {
    if (!syncConnectionId) return;
    setSyncLoading(true); setError("");
    try {
      await api.post("/integrations/sync/rules", { connectionId: syncConnectionId, eventType: "ticket.created", action: "zendesk.create_ticket" });
      await load();
    } catch (e: any) { setError(e.response?.data?.error || "Sync-Regel konnte nicht erstellt werden."); }
    finally { setSyncLoading(false); }
  }

  async function toggleSyncRule(rule: SyncRule) {
    setSyncLoading(true); setError("");
    try { await api.patch(`/integrations/sync/rules/${rule.id}`, { enabled: !rule.enabled }); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Sync-Regel konnte nicht aktualisiert werden."); }
    finally { setSyncLoading(false); }
  }

  async function removeSyncRule(rule: SyncRule) {
    if (!window.confirm("Diese automatische Sync-Regel wirklich löschen?")) return;
    setSyncLoading(true); setError("");
    try { await api.delete(`/integrations/sync/rules/${rule.id}`); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Sync-Regel konnte nicht gelöscht werden."); }
    finally { setSyncLoading(false); }
  }

  async function createWebhook(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setSecret("");
    try {
      const { data } = await api.post("/webhooks", { name, url, eventTypes: selectedEvents });
      setSecret(data.secret); setName(""); setUrl(""); await load();
    } catch (e: any) { setError(e.response?.data?.error || "Webhook konnte nicht erstellt werden."); }
    finally { setLoading(false); }
  }

  async function toggle(subscription: Subscription) {
    try { await api.patch(`/webhooks/${subscription.id}`, { enabled: !subscription.enabled }); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Webhook konnte nicht aktualisiert werden."); }
  }
  async function rotate(subscription: Subscription) {
    if (!window.confirm(`Secret für „${subscription.name}“ rotieren? Das alte Secret wird sofort ungültig.`)) return;
    try { const { data } = await api.post(`/webhooks/${subscription.id}/rotate-secret`); setSecret(data.secret); }
    catch (e: any) { setError(e.response?.data?.error || "Secret konnte nicht rotiert werden."); }
  }
  async function remove(subscription: Subscription) {
    if (!window.confirm(`Webhook „${subscription.name}“ wirklich löschen?`)) return;
    try {
      await api.delete(`/webhooks/${subscription.id}`);
      if (deliverySubscription?.id === subscription.id) { setDeliverySubscription(null); setDeliveries([]); }
      await load();
    } catch (e: any) { setError(e.response?.data?.error || "Webhook konnte nicht gelöscht werden."); }
  }
  async function showDeliveries(subscription: Subscription) {
    setDeliverySubscription(subscription); setDeliveryLoading(true); setError("");
    try { const { data } = await api.get(`/webhooks/${subscription.id}/deliveries`); setDeliveries(data); }
    catch (e: any) { setError(e.response?.data?.error || "Webhook-Zustellungen konnten nicht geladen werden."); }
    finally { setDeliveryLoading(false); }
  }

  const zendeskConnections = connections.filter((connection) => connection.provider === "zendesk");
  const connectionName = (id: string) => connections.find((connection) => connection.id === id)?.name || id;

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <div><p className="text-sm text-muted-foreground">Integrationen</p><h1 className="text-2xl font-semibold">Provider & Webhooks</h1><p className="mt-2 text-sm text-muted-foreground">Direkte CRM-/Support-Verbindungen, kontrollierte Automationen und signierte Events an externe Systeme verwalten.</p></div>
    {error && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}

    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Direkte Integration hinzufügen</h2><p className="mt-1 text-sm text-muted-foreground">Zugangsdaten werden verschlüsselt gespeichert und nach dem Speichern nicht wieder angezeigt.</p><form onSubmit={createIntegration} className="mt-4 space-y-4"><div className="grid gap-3 md:grid-cols-2"><label className="text-sm"><span className="mb-1 block font-medium">Provider</span><select value={provider} onChange={(e) => setProvider(e.target.value as "hubspot" | "zendesk")} className="w-full rounded-lg border bg-background px-3 py-2"><option value="hubspot">HubSpot CRM</option><option value="zendesk">Zendesk Support</option></select></label><label className="text-sm"><span className="mb-1 block font-medium">Name</span><input required value={integrationName} onChange={(e) => setIntegrationName(e.target.value)} placeholder={provider === "hubspot" ? "Primary HubSpot" : "Customer Support Zendesk"} className="w-full rounded-lg border bg-background px-3 py-2" /></label></div>{provider === "zendesk" && <div className="grid gap-3 md:grid-cols-2"><label className="text-sm"><span className="mb-1 block font-medium">Zendesk Subdomain</span><div className="flex items-center rounded-lg border bg-background"><input required value={zendeskSubdomain} onChange={(e) => setZendeskSubdomain(e.target.value)} placeholder="meinefirma" className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none" /><span className="pr-3 text-xs text-muted-foreground">.zendesk.com</span></div></label><label className="text-sm"><span className="mb-1 block font-medium">Account-E-Mail</span><input required type="email" value={zendeskEmail} onChange={(e) => setZendeskEmail(e.target.value)} placeholder="admin@example.com" className="w-full rounded-lg border bg-background px-3 py-2" /></label></div>}<label className="block text-sm"><span className="mb-1 block font-medium">{provider === "hubspot" ? "HubSpot Access Token" : "Zendesk API Token"}</span><input required type="password" autoComplete="new-password" value={providerToken} onChange={(e) => setProviderToken(e.target.value)} className="w-full rounded-lg border bg-background px-3 py-2" /></label><button disabled={integrationLoading} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{integrationLoading ? "Speichert…" : "Integration speichern & testen"}</button></form></section>

    <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">Direkte Verbindungen</h2><div className="space-y-3">{connections.length ? connections.map((connection) => <div key={connection.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{connection.name}</p><span className="rounded-full border px-2 py-0.5 text-xs">{connection.provider === "hubspot" ? "HubSpot" : "Zendesk"}</span><span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{connection.status}</span><span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{connection.enabled ? "aktiv" : "pausiert"}</span></div>{connection.provider === "zendesk" && <p className="mt-2 text-sm text-muted-foreground">{connection.config.email} · {connection.config.subdomain}.zendesk.com</p>}<p className="mt-2 text-xs text-muted-foreground">Credentials: {connection.credentialsConfigured ? "konfiguriert" : "fehlen"}{connection.lastTestedAt ? ` · Zuletzt getestet: ${new Date(connection.lastTestedAt).toLocaleString("de-DE")}` : ""}</p>{connection.lastError && <p className="mt-1 text-xs text-destructive">{connection.lastError}</p>}</div><div className="flex flex-wrap gap-2"><button disabled={integrationLoading} onClick={() => testIntegration(connection)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">Testen</button><button onClick={() => toggleIntegration(connection)} className="rounded-lg border px-3 py-1.5 text-xs">{connection.enabled ? "Pausieren" : "Aktivieren"}</button><button onClick={() => removeIntegration(connection)} className="rounded-lg border px-3 py-1.5 text-xs text-destructive">Löschen</button></div></div></div>) : <p className="text-sm text-muted-foreground">Noch keine direkten Provider-Verbindungen angelegt.</p>}</div></section>

    <section className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Automatische Synchronisation</h2><p className="mt-1 text-sm text-muted-foreground">Neue Regeln sind immer deaktiviert. Aktuell unterstützt: lokales <code>ticket.created</code> → Zendesk-Ticket.</p></div><button onClick={() => load()} className="rounded-lg border px-3 py-1.5 text-xs">Aktualisieren</button></div><div className="mt-4 flex flex-col gap-3 md:flex-row"><select value={syncConnectionId} onChange={(e) => setSyncConnectionId(e.target.value)} className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"><option value="">Zendesk-Verbindung wählen</option>{zendeskConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select><button disabled={!syncConnectionId || syncLoading} onClick={createSyncRule} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">Regel anlegen</button></div><div className="mt-4 space-y-2">{syncRules.length ? syncRules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">{rule.eventType} → {rule.action}</p><p className="mt-1 text-xs text-muted-foreground">{connectionName(rule.connectionId)} · {rule.enabled ? "aktiv" : "deaktiviert"}</p></div><div className="flex gap-2"><button disabled={syncLoading} onClick={() => toggleSyncRule(rule)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">{rule.enabled ? "Deaktivieren" : "Aktivieren"}</button><button disabled={syncLoading} onClick={() => removeSyncRule(rule)} className="rounded-lg border px-3 py-1.5 text-xs text-destructive disabled:opacity-50">Löschen</button></div></div>) : <p className="text-sm text-muted-foreground">Noch keine automatischen Sync-Regeln angelegt.</p>}</div><div className="mt-5"><h3 className="text-sm font-medium">Letzte Sync-Ausführungen</h3><div className="mt-2 space-y-2">{syncExecutions.length ? syncExecutions.slice(0, 20).map((execution) => <div key={execution.id} className="grid gap-2 rounded-lg border p-3 text-xs md:grid-cols-[1fr_.7fr_.7fr_2fr]"><div><p className="font-medium">{execution.eventKey}</p><p className="text-muted-foreground">{new Date(execution.createdAt).toLocaleString("de-DE")}</p></div><div><p className="text-muted-foreground">Status</p><p>{execution.status}</p></div><div><p className="text-muted-foreground">Extern</p><p>{execution.externalId || "–"}</p></div><div className="min-w-0"><p className="text-muted-foreground">Fehler</p><p className="break-words">{execution.error || "–"}</p></div></div>) : <p className="text-sm text-muted-foreground">Noch keine Sync-Ausführungen vorhanden.</p>}</div></div></section>

    {secret && <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Signing Secret – nur jetzt sichtbar</h2><p className="mt-2 break-all rounded-lg border bg-background p-3 font-mono text-sm">{secret}</p><p className="mt-2 text-xs text-muted-foreground">Für die Prüfung: HMAC-SHA256 über <code>timestamp.body</code>, Header <code>X-SupportAI-Signature: v1=…</code>.</p></div>}

    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Webhook erstellen</h2><form onSubmit={createWebhook} className="mt-4 space-y-4"><div className="grid gap-3 md:grid-cols-2"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. CRM Sync" className="rounded-lg border bg-background px-3 py-2 text-sm" /><input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/support" className="rounded-lg border bg-background px-3 py-2 text-sm" /></div><div><p className="mb-2 text-sm font-medium">Events</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{eventTypes.map((type) => <label key={type} className="flex items-center gap-2 rounded-lg border p-2 text-sm"><input type="checkbox" checked={selectedEvents.includes(type)} onChange={(e) => setSelectedEvents((current) => e.target.checked ? [...new Set([...current, type])] : current.filter((item) => item !== type))} />{type}</label>)}</div></div><button disabled={loading || selectedEvents.length === 0} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{loading ? "Erstellt…" : "Webhook erstellen"}</button></form></section>

    <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">Webhook Subscriptions</h2><div className="space-y-3">{subscriptions.length ? subscriptions.map((subscription) => <div key={subscription.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-medium">{subscription.name}</p><span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{subscription.enabled ? "aktiv" : "pausiert"}</span></div><p className="mt-1 break-all text-sm text-muted-foreground">{subscription.url}</p><p className="mt-2 text-xs text-muted-foreground">{subscription.eventTypes.join(", ")}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => showDeliveries(subscription)} className="rounded-lg border px-3 py-1.5 text-xs">Zustellungen</button><button onClick={() => toggle(subscription)} className="rounded-lg border px-3 py-1.5 text-xs">{subscription.enabled ? "Pausieren" : "Aktivieren"}</button><button onClick={() => rotate(subscription)} className="rounded-lg border px-3 py-1.5 text-xs">Secret rotieren</button><button onClick={() => remove(subscription)} className="rounded-lg border px-3 py-1.5 text-xs text-destructive">Löschen</button></div></div></div>) : <p className="text-sm text-muted-foreground">Noch keine Webhooks angelegt.</p>}</div></section>

    {deliverySubscription && <section className="rounded-xl border bg-card p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Zustellungen · {deliverySubscription.name}</h2><p className="mt-1 text-xs text-muted-foreground">Die letzten 100 Delivery-Versuche aus der persistenten Outbox.</p></div><button onClick={() => showDeliveries(deliverySubscription)} disabled={deliveryLoading} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">Aktualisieren</button></div>{deliveryLoading ? <p className="text-sm text-muted-foreground">Lädt…</p> : deliveries.length ? <div className="space-y-2">{deliveries.map((row) => <div key={row.delivery.id} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[1.2fr_.8fr_.7fr_.7fr_2fr]"><div><p className="font-medium">{row.eventType}</p><p className="text-xs text-muted-foreground">{new Date(row.occurredAt).toLocaleString("de-DE")}</p></div><div><p className="text-xs text-muted-foreground">Status</p><p>{row.delivery.status}</p></div><div><p className="text-xs text-muted-foreground">HTTP</p><p>{row.delivery.responseStatus ?? "–"}</p></div><div><p className="text-xs text-muted-foreground">Versuche</p><p>{row.delivery.attempts}</p></div><div className="min-w-0"><p className="text-xs text-muted-foreground">Letzter Fehler</p><p className="break-words text-xs">{row.delivery.lastError || "–"}</p></div></div>)}</div> : <p className="text-sm text-muted-foreground">Noch keine Zustellungen vorhanden.</p>}</section>}
  </main>;
}
