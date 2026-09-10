"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AvailabilityEditor } from "./AvailabilityEditor";
import { BookingManager, type Booking, type CalendarSync } from "./BookingManager";

type Connection = { id: string; provider: string; externalAccountId?: string | null; status: string; userId?: string | null };
type MeetingType = { id: string; name: string; description?: string | null; durationMinutes: number; enabled: boolean; bufferBeforeMinutes: number; bufferAfterMinutes: number; minimumNoticeMinutes: number; maxFutureDays: number };
type MeetingTypeDraft = Pick<MeetingType, "name" | "description" | "durationMinutes" | "enabled" | "bufferBeforeMinutes" | "bufferAfterMinutes" | "minimumNoticeMinutes" | "maxFutureDays">;

export default function AdminSchedulingPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [types, setTypes] = useState<MeetingType[]>([]);
  const [typeDrafts, setTypeDrafts] = useState<Record<string, MeetingTypeDraft>>({});
  const [savingTypeId, setSavingTypeId] = useState<string | null>(null);
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
      const nextTypes: MeetingType[] = typesResult.data;
      const nextBookings: Booking[] = bookingsResult.data;
      setConnections(connectionsResult.data); setTypes(nextTypes); setBookings(nextBookings);
      setTypeDrafts(Object.fromEntries(nextTypes.map((type) => [type.id, {
        name: type.name,
        description: type.description || "",
        durationMinutes: type.durationMinutes,
        enabled: type.enabled,
        bufferBeforeMinutes: type.bufferBeforeMinutes,
        bufferAfterMinutes: type.bufferAfterMinutes,
        minimumNoticeMinutes: type.minimumNoticeMinutes,
        maxFutureDays: type.maxFutureDays,
      }])));
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

  function updateDraft(id: string, patch: Partial<MeetingTypeDraft>) {
    setTypeDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function saveMeetingType(id: string) {
    const draft = typeDrafts[id]; if (!draft) return;
    setSavingTypeId(id); setError("");
    try {
      await api.patch(`/scheduling/meeting-types/${id}`, draft);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || "Meeting Type konnte nicht gespeichert werden.");
    } finally {
      setSavingTypeId(null);
    }
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

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <div><p className="text-sm text-muted-foreground">Integrationen & Termine</p><h1 className="text-2xl font-semibold">Scheduling</h1><p className="mt-2 text-sm text-muted-foreground">Kalender anbinden, Terminarten verwalten und aktuelle Buchungen prüfen.</p></div>
    {error && <div className="rounded-lg border p-3 text-sm text-destructive">{error}</div>}

    <section className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Kalenderverbindungen</h2><div className="flex gap-2"><button onClick={() => connect("google")} className="rounded-lg border px-3 py-2 text-sm">Google Calendar verbinden</button><button onClick={() => connect("microsoft")} className="rounded-lg border px-3 py-2 text-sm">Microsoft 365 verbinden</button></div></div><div className="mt-4 space-y-2">{connections.length ? connections.map((connection) => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium capitalize">{connection.provider}</p><p className="text-xs text-muted-foreground">{connection.externalAccountId || "Verbunden"} · {connection.status}</p></div><button onClick={() => disconnect(connection.id)} className="rounded-lg border px-3 py-2 text-sm text-destructive">Trennen</button></div>) : <p className="text-sm text-muted-foreground">Noch kein Kalender verbunden.</p>}</div></section>

    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Meeting Types</h2><p className="mt-1 text-sm text-muted-foreground">Dauer, Pufferzeiten und Buchungsgrenzen gelten direkt für Slot-Suche und neue Buchungen.</p><form onSubmit={createMeetingType} className="mt-4 flex flex-wrap gap-2"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Beratungsgespräch" className="min-w-64 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><input type="number" min={5} max={480} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="w-28 rounded-lg border bg-background px-3 py-2 text-sm" /><button className="rounded-lg bg-foreground px-4 py-2 text-sm text-background">Erstellen</button></form><div className="mt-4 grid gap-4 lg:grid-cols-2">{types.map((type) => {
      const draft = typeDrafts[type.id]; if (!draft) return null;
      return <div key={type.id} className="rounded-lg border p-4"><div className="flex items-center justify-between gap-3"><span className="font-medium">{type.name}</span><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(type.id, { enabled: event.target.checked })} />{draft.enabled ? "aktiv" : "inaktiv"}</label></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted-foreground">Name<input value={draft.name} onChange={(event) => updateDraft(type.id, { name: event.target.value })} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label><label className="text-xs text-muted-foreground">Dauer (Min.)<input type="number" min={5} max={480} value={draft.durationMinutes} onChange={(event) => updateDraft(type.id, { durationMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label><label className="text-xs text-muted-foreground">Puffer davor (Min.)<input type="number" min={0} max={240} value={draft.bufferBeforeMinutes} onChange={(event) => updateDraft(type.id, { bufferBeforeMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label><label className="text-xs text-muted-foreground">Puffer danach (Min.)<input type="number" min={0} max={240} value={draft.bufferAfterMinutes} onChange={(event) => updateDraft(type.id, { bufferAfterMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label><label className="text-xs text-muted-foreground">Mindestvorlauf (Min.)<input type="number" min={0} max={10080} value={draft.minimumNoticeMinutes} onChange={(event) => updateDraft(type.id, { minimumNoticeMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label><label className="text-xs text-muted-foreground">Max. Zukunft (Tage)<input type="number" min={1} max={365} value={draft.maxFutureDays} onChange={(event) => updateDraft(type.id, { maxFutureDays: Number(event.target.value) })} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label></div><label className="mt-3 block text-xs text-muted-foreground">Beschreibung<textarea rows={2} value={draft.description || ""} onChange={(event) => updateDraft(type.id, { description: event.target.value })} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label><div className="mt-3 flex justify-end"><button type="button" onClick={() => saveMeetingType(type.id)} disabled={savingTypeId === type.id} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{savingTypeId === type.id ? "Speichert…" : "Änderungen speichern"}</button></div></div>;
    })}</div></section>

    <AvailabilityEditor meetingTypes={types} />

    <BookingManager bookings={bookings} syncByBooking={syncByBooking} retryingBookingId={retryingBookingId} onRetrySync={retryCalendarSync} onReload={load} onError={setError} />
  </main>;
}
