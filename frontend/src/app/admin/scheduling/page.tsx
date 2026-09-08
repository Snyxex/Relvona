"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Connection = { id: string; provider: string; externalAccountId?: string | null; status: string; userId?: string | null };
type MeetingType = { id: string; name: string; durationMinutes: number; enabled: boolean; minimumNoticeMinutes: number; maxFutureDays: number };
type Booking = { id: string; startsAt: string; endsAt: string; status: string; meetingUrl?: string | null; guestEmail?: string | null };

export default function AdminSchedulingPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [types, setTypes] = useState<MeetingType[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [connectionsResult, typesResult, bookingsResult] = await Promise.all([api.get("/scheduling/connections"), api.get("/scheduling/meeting-types"), api.get("/scheduling/bookings")]);
      setConnections(connectionsResult.data); setTypes(typesResult.data); setBookings(bookingsResult.data);
    } catch (e: any) { setError(e.response?.data?.error || "Scheduling konnte nicht geladen werden."); }
  }

  useEffect(() => { load(); }, []);

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

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <div><p className="text-sm text-muted-foreground">Integrationen & Termine</p><h1 className="text-2xl font-semibold">Scheduling</h1><p className="mt-2 text-sm text-muted-foreground">Kalender anbinden, Terminarten verwalten und aktuelle Buchungen prüfen.</p></div>
    {error && <div className="rounded-lg border p-3 text-sm text-destructive">{error}</div>}

    <section className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Kalenderverbindungen</h2><div className="flex gap-2"><button onClick={() => connect("google")} className="rounded-lg border px-3 py-2 text-sm">Google Calendar verbinden</button><button onClick={() => connect("microsoft")} className="rounded-lg border px-3 py-2 text-sm">Microsoft 365 verbinden</button></div></div><div className="mt-4 space-y-2">{connections.length ? connections.map((connection) => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium capitalize">{connection.provider}</p><p className="text-xs text-muted-foreground">{connection.externalAccountId || "Verbunden"} · {connection.status}</p></div><button onClick={() => disconnect(connection.id)} className="rounded-lg border px-3 py-2 text-sm text-destructive">Trennen</button></div>) : <p className="text-sm text-muted-foreground">Noch kein Kalender verbunden.</p>}</div></section>

    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Meeting Types</h2><form onSubmit={createMeetingType} className="mt-4 flex flex-wrap gap-2"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Beratungsgespräch" className="min-w-64 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><input type="number" min={5} max={480} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="w-28 rounded-lg border bg-background px-3 py-2 text-sm" /><button className="rounded-lg bg-foreground px-4 py-2 text-sm text-background">Erstellen</button></form><div className="mt-4 grid gap-3 md:grid-cols-2">{types.map((type) => <div key={type.id} className="rounded-lg border p-4"><div className="flex justify-between gap-3"><span className="font-medium">{type.name}</span><span className="text-xs text-muted-foreground">{type.enabled ? "aktiv" : "inaktiv"}</span></div><p className="mt-2 text-sm text-muted-foreground">{type.durationMinutes} Min. · Vorlauf {type.minimumNoticeMinutes} Min. · bis {type.maxFutureDays} Tage</p></div>)}</div></section>

    <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">Buchungen</h2><div className="space-y-3">{bookings.length ? bookings.map((booking) => <div key={booking.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><p className="font-medium">{new Date(booking.startsAt).toLocaleString("de-DE")}</p><p className="text-xs text-muted-foreground">{booking.guestEmail || "Ohne Gast-E-Mail"} · {booking.status}</p></div>{booking.meetingUrl && <a href={booking.meetingUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-sm">Meeting öffnen</a>}</div>) : <p className="text-sm text-muted-foreground">Noch keine Buchungen.</p>}</div></section>
  </main>;
}
