"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Subscription = { id: string; name: string; url: string; eventTypes: string[]; enabled: boolean; createdAt: string };
type Delivery = {
  delivery: { id: string; status: string; attempts: number; responseStatus?: number | null; lastError?: string | null; deliveredAt?: string | null; createdAt: string };
  eventType: string;
  occurredAt: string;
};

export default function AdminIntegrationsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
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

  async function load() {
    setError("");
    try {
      const [subscriptionsResult, eventsResult] = await Promise.all([api.get("/webhooks"), api.get("/webhooks/event-types")]);
      setSubscriptions(subscriptionsResult.data);
      setEventTypes(eventsResult.data);
    } catch (e: any) { setError(e.response?.data?.error || "Integrationen konnten nicht geladen werden."); }
  }
  useEffect(() => { void load(); }, []);

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

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <div><p className="text-sm text-muted-foreground">Integrationen</p><h1 className="text-2xl font-semibold">Webhooks</h1><p className="mt-2 text-sm text-muted-foreground">Signierte Events an externe Systeme senden. Ziele müssen standardmäßig öffentliches HTTPS verwenden.</p></div>
    {error && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}
    {secret && <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Signing Secret – nur jetzt sichtbar</h2><p className="mt-2 break-all rounded-lg border bg-background p-3 font-mono text-sm">{secret}</p><p className="mt-2 text-xs text-muted-foreground">Für die Prüfung: HMAC-SHA256 über <code>timestamp.body</code>, Header <code>X-SupportAI-Signature: v1=…</code>.</p></div>}

    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Webhook erstellen</h2><form onSubmit={createWebhook} className="mt-4 space-y-4"><div className="grid gap-3 md:grid-cols-2"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. CRM Sync" className="rounded-lg border bg-background px-3 py-2 text-sm" /><input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/support" className="rounded-lg border bg-background px-3 py-2 text-sm" /></div><div><p className="mb-2 text-sm font-medium">Events</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{eventTypes.map((type) => <label key={type} className="flex items-center gap-2 rounded-lg border p-2 text-sm"><input type="checkbox" checked={selectedEvents.includes(type)} onChange={(e) => setSelectedEvents((current) => e.target.checked ? [...new Set([...current, type])] : current.filter((item) => item !== type))} />{type}</label>)}</div></div><button disabled={loading || selectedEvents.length === 0} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{loading ? "Erstellt…" : "Webhook erstellen"}</button></form></section>

    <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">Subscriptions</h2><div className="space-y-3">{subscriptions.length ? subscriptions.map((subscription) => <div key={subscription.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-medium">{subscription.name}</p><span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{subscription.enabled ? "aktiv" : "pausiert"}</span></div><p className="mt-1 break-all text-sm text-muted-foreground">{subscription.url}</p><p className="mt-2 text-xs text-muted-foreground">{subscription.eventTypes.join(", ")}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => showDeliveries(subscription)} className="rounded-lg border px-3 py-1.5 text-xs">Zustellungen</button><button onClick={() => toggle(subscription)} className="rounded-lg border px-3 py-1.5 text-xs">{subscription.enabled ? "Pausieren" : "Aktivieren"}</button><button onClick={() => rotate(subscription)} className="rounded-lg border px-3 py-1.5 text-xs">Secret rotieren</button><button onClick={() => remove(subscription)} className="rounded-lg border px-3 py-1.5 text-xs text-destructive">Löschen</button></div></div></div>) : <p className="text-sm text-muted-foreground">Noch keine Webhooks angelegt.</p>}</div></section>

    {deliverySubscription && <section className="rounded-xl border bg-card p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Zustellungen · {deliverySubscription.name}</h2><p className="mt-1 text-xs text-muted-foreground">Die letzten 100 Delivery-Versuche aus der persistenten Outbox.</p></div><button onClick={() => showDeliveries(deliverySubscription)} disabled={deliveryLoading} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">Aktualisieren</button></div>{deliveryLoading ? <p className="text-sm text-muted-foreground">Lädt…</p> : deliveries.length ? <div className="space-y-2">{deliveries.map((row) => <div key={row.delivery.id} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[1.2fr_.8fr_.7fr_.7fr_2fr]"><div><p className="font-medium">{row.eventType}</p><p className="text-xs text-muted-foreground">{new Date(row.occurredAt).toLocaleString("de-DE")}</p></div><div><p className="text-xs text-muted-foreground">Status</p><p>{row.delivery.status}</p></div><div><p className="text-xs text-muted-foreground">HTTP</p><p>{row.delivery.responseStatus ?? "–"}</p></div><div><p className="text-xs text-muted-foreground">Versuche</p><p>{row.delivery.attempts}</p></div><div className="min-w-0"><p className="text-xs text-muted-foreground">Letzter Fehler</p><p className="break-words text-xs">{row.delivery.lastError || "–"}</p></div></div>)}</div> : <p className="text-sm text-muted-foreground">Noch keine Zustellungen vorhanden.</p>}</section>}
  </main>;
}
