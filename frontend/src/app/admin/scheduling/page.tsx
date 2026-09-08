"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Connection = { id: string; provider: string; externalAccountId?: string | null; status: string; userId?: string | null };
type MeetingType = { id: string; name: string; durationMinutes: number; enabled: boolean; minimumNoticeMinutes: number; maxFutureDays: number };
type Booking = { id: string; startsAt: string; endsAt: string; status: string; meetingUrl?: string | null; guestEmail?: string | null; providerEventId?: string | null };
type CalendarSync = { bookingId: string; status: string; action?: string | null; attempts: number; lastError?: string | null; nextAttemptAt?: string | null };

export default function AdminSchedulingPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [types, setTypes] = useState<MeetingType[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [syncByBooking, setSyncByBooking] = useState<Record<string, CalendarSync>>({});
  const [retryingBookingId, setRetryingBookingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [connectionsResult, typesResult, bookingsResult] = await Promise.all([api.get("/scheduling/connections"), api.get("/scheduling/meeting-types"), api.get("/scheduling/bookings")]);
      const nextBookings: Booking[] = bookingsResult.data;
      setConnections(connectionsResult.data); setTypes(typesResult.data); setBookings(nextBookings);
      const statuses = await Promise.all(nextBookings.map(async (booking) => {
        try {
          const result = await api.get(`/scheduling/bookings/${booking.id}/calendar-sync`);
          return [booking.id, result.data] as const;
        } catch {
          return [booking.id, { bookingId: booking.id, status: "unknown", attempts: 0 }] as const;
        }
      }));
      setSyncByBooking(Object.fromEntries(statuses));
    } catch (e: any) { setError(e.response?.data?.error || "Scheduling konnte nicht geladen werden."); }
  }

  useEffect(() => { void load(); }, []);

  async function connect(provider: "google" | "microsoft") {
    setError("");
    try {
      const { data } = await api.post(`/calendar-oauth/${provider}/start`, { redirectAfter: "/admin/scheduling" });
      if (data.authorizationUrl) window.location.assign(data.authorizationUrl);
    } catch (e: any) { setError(e.response?.data?.error || "Kalenderverbindung konnte nicht gestartet werden."); }
  }

  async function disconnect(id: string) {
    await api.delete(`/scheduling/connections/${id}`); await load();
  }

  async function createMeetingType(event: FormEvent) {
    event.preventDefault(); setError("");
    try { await api.post("/scheduling/meeting-types", { name, durationMinutes: duration }); setName(""); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Meeting Type konnte nicht erstellt werden."); }
  }

  async function retryCalendarSync(bookingId: string) {
    setRetryingBookingId(bookingId);
    setError("");
    try {
      await api.post(`/scheduling/bookings/${bookingId}/calendar-sync/retry`);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || "Kalender-Synchronisierung konnte nicht erneut gestartet werden.");
    } finally {
      setRetryingBookingId(null);
    }
  }

  function syncLabel(sync?: CalendarSync) {
    if (!sync || sync.status === "not_required") return "kein externer Sync";
    if (sync.status === "synced") return "Kalender synchron";
    if (sync.status === "processing") return "Synchronisierung läuft";
    if (sync.status === "pending") return "Synchronisierung ausstehend";
    if (sync.status === "failed") return "Synchronisierung fehlgeschlagen";
    if (sync.status === "exhausted") return "Retries ausgeschöpft";
    return "Sync-Status unbekannt";
  }

  function syncClass(sync?: CalendarSync) {
    if (sync?.status === "synced" || sync?.status === "not_required") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    if (sync?.status === "failed" || sync?.status === "exhausted") return "border-destructive/40 bg-destructive/10 text-destructive";
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <div><p className="text-sm text-muted-foreground">Integrationen & Termine</p><h1 className="text-2xl font-semibold">Scheduling</h1><p className="mt-2 text-sm text-muted-foreground">Kalender anbinden, Terminarten verwalten und aktuelle Buchungen prüfen.</p></div>
    {error && <div className="rounded-lg border p-3 text-sm text-destructive">{error}</div>}

    <section className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Kalenderverbindungen</h2><div className="flex gap-2"><button onClick={() => connect("google")} className="rounded-lg border px-3 py-2 text-sm">Google Calendar verbinden</button><button onClick={() => connect("microsoft")} className="rounded-lg border px-3 py-2 text-sm">Microsoft 365 verbinden</button></div></div><div className="mt-4 space-y-2">{connections.length ? connections.map((connection) => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium capitalize">{connection.provider}</p><p className="text-xs text-muted-foreground">{connection.externalAccountId || "Verbunden"} · {connection.status}</p></div><button onClick={() => disconnect(connection.id)} className="rounded-lg border px-3 py-2 text-sm text-destructive">Trennen</button></div>) : <p className="text-sm text-muted-foreground">Noch kein Kalender verbunden.</p>}</div></section>

    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Meeting Types</h2><form onSubmit={createMeetingType} className="mt-4 flex flex-wrap gap-2"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Beratungsgespräch" className="min-w-64 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><input type="number" min={5} max={480} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="w-28 rounded-lg border bg-background px-3 py-2 text-sm" /><button className="rounded-lg bg-foreground px-4 py-2 text-sm text-background">Erstellen</button></form><div className="mt-4 grid gap-3 md:grid-cols-2">{types.map((type) => <div key={type.id} className="rounded-lg border p-4"><div className="flex justify-between gap-3"><span className="font-medium">{type.name}</span><span className="text-xs text-muted-foreground">{type.enabled ? "aktiv" : "inaktiv"}</span></div><p className="mt-2 text-sm text-muted-foreground">{type.durationMinutes} Min. · Vorlauf {type.minimumNoticeMinutes} Min. · bis {type.maxFutureDays} Tage</p></div>)}</div></section>

    <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">Buchungen</h2><div className="space-y-3">{bookings.length ? bookings.map((booking) => {
      const sync = syncByBooking[booking.id];
      const retryable = sync?.status === "failed" || sync?.status === "exhausted";
      return <div key={booking.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{new Date(booking.startsAt).toLocaleString("de-DE")}</p><p className="text-xs text-muted-foreground">{booking.guestEmail || "Ohne Gast-E-Mail"} · {booking.status}</p></div><div className="flex flex-wrap gap-2">{booking.meetingUrl && <a href={booking.meetingUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-sm">Meeting öffnen</a>}{retryable && <button type="button" disabled={retryingBookingId === booking.id} onClick={() => retryCalendarSync(booking.id)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{retryingBookingId === booking.id ? "Retry läuft…" : "Kalender-Sync erneut versuchen"}</button>}</div></div><div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${syncClass(sync)}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{syncLabel(sync)}</span>{sync?.action && <span>{sync.action} · Versuch {sync.attempts}</span>}</div>{sync?.lastError && <p className="mt-1 break-words opacity-80">{sync.lastError}</p>}{sync?.nextAttemptAt && <p className="mt-1 opacity-70">Nächster automatischer Versuch: {new Date(sync.nextAttemptAt).toLocaleString("de-DE")}</p>}</div></div>;
    }) : <p className="text-sm text-muted-foreground">Noch keine Buchungen.</p>}</div></section>
  </main>;
}
