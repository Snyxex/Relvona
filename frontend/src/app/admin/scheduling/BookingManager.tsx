"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";

export type Booking = {
  id: string;
  meetingTypeId: string;
  assignedUserId?: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  meetingUrl?: string | null;
  guestEmail?: string | null;
  guestName?: string | null;
};

export type CalendarSync = {
  bookingId: string;
  status: string;
  action?: string | null;
  attempts: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
};

type Slot = { startsAt: string; endsAt: string; timezone: string };

type Props = {
  bookings: Booking[];
  syncByBooking: Record<string, CalendarSync>;
  retryingBookingId: string | null;
  onRetrySync: (bookingId: string) => Promise<void>;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
};

export function BookingManager({ bookings, syncByBooking, retryingBookingId, onRetrySync, onReload, onError }: Props) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [rangeFilter, setRangeFilter] = useState("upcoming");
  const [query, setQuery] = useState("");
  const [slotsByBooking, setSlotsByBooking] = useState<Record<string, Slot[]>>({});
  const [selectedSlot, setSelectedSlot] = useState<Record<string, string>>({});
  const [loadingSlotsId, setLoadingSlotsId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const now = Date.now();
    const normalizedQuery = query.trim().toLowerCase();
    return bookings.filter((booking) => {
      if (statusFilter !== "all" && booking.status !== statusFilter) return false;
      const startsAt = new Date(booking.startsAt).getTime();
      if (rangeFilter === "upcoming" && startsAt < now) return false;
      if (rangeFilter === "past" && startsAt >= now) return false;
      if (rangeFilter === "7d" && (startsAt < now || startsAt > now + 7 * 86_400_000)) return false;
      if (rangeFilter === "30d" && (startsAt < now || startsAt > now + 30 * 86_400_000)) return false;
      if (normalizedQuery) {
        const haystack = `${booking.guestName || ""} ${booking.guestEmail || ""} ${booking.id}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [bookings, statusFilter, rangeFilter, query]);

  async function loadSlots(booking: Booking) {
    setLoadingSlotsId(booking.id); onError("");
    try {
      const from = new Date(Date.now() + 15 * 60_000);
      const to = new Date(Date.now() + 14 * 86_400_000);
      const params = new URLSearchParams({ meetingTypeId: booking.meetingTypeId, from: from.toISOString(), to: to.toISOString(), limit: "30" });
      if (booking.assignedUserId) params.set("assignedUserId", booking.assignedUserId);
      const { data } = await api.get(`/scheduling/slots?${params.toString()}`);
      setSlotsByBooking((current) => ({ ...current, [booking.id]: data }));
      setSelectedSlot((current) => ({ ...current, [booking.id]: "" }));
    } catch (e: any) {
      onError(e.response?.data?.error || "Freie Termine konnten nicht geladen werden.");
    } finally {
      setLoadingSlotsId(null);
    }
  }

  async function reschedule(booking: Booking) {
    const startsAt = selectedSlot[booking.id];
    const slot = slotsByBooking[booking.id]?.find((item) => item.startsAt === startsAt);
    if (!slot) return;
    setMutatingId(booking.id); onError("");
    try {
      await api.post(`/scheduling/bookings/${booking.id}/reschedule`, { startsAt: slot.startsAt, timezone: slot.timezone });
      setSlotsByBooking((current) => { const next = { ...current }; delete next[booking.id]; return next; });
      setSelectedSlot((current) => { const next = { ...current }; delete next[booking.id]; return next; });
      await onReload();
    } catch (e: any) {
      onError(e.response?.data?.error || "Termin konnte nicht umgebucht werden.");
      await loadSlots(booking);
    } finally {
      setMutatingId(null);
    }
  }

  async function cancel(booking: Booking) {
    if (!window.confirm("Diesen Termin wirklich stornieren?")) return;
    setMutatingId(booking.id); onError("");
    try {
      await api.post(`/scheduling/bookings/${booking.id}/cancel`, {});
      setSlotsByBooking((current) => { const next = { ...current }; delete next[booking.id]; return next; });
      await onReload();
    } catch (e: any) {
      onError(e.response?.data?.error || "Termin konnte nicht storniert werden.");
    } finally {
      setMutatingId(null);
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

  return <section className="rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Buchungen</h2><p className="mt-1 text-sm text-muted-foreground">Termine filtern, über freie Slots umbuchen und direkt stornieren.</p></div><span className="text-xs text-muted-foreground">{filtered.length} von {bookings.length}</span></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Gast, E-Mail oder Booking-ID" className="rounded-lg border bg-background px-3 py-2 text-sm" />
      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="all">Alle Status</option><option value="confirmed">Bestätigt</option><option value="pending">Ausstehend</option><option value="cancelled">Storniert</option></select>
      <select value={rangeFilter} onChange={(event) => setRangeFilter(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="upcoming">Kommende</option><option value="7d">Nächste 7 Tage</option><option value="30d">Nächste 30 Tage</option><option value="past">Vergangene</option><option value="all">Alle Zeiträume</option></select>
      <button type="button" onClick={() => { setQuery(""); setStatusFilter("all"); setRangeFilter("upcoming"); }} className="rounded-lg border px-3 py-2 text-sm">Filter zurücksetzen</button>
    </div>

    <div className="mt-4 space-y-3">{filtered.length ? filtered.map((booking) => {
      const sync = syncByBooking[booking.id];
      const retryable = sync?.status === "failed" || sync?.status === "exhausted";
      const slots = slotsByBooking[booking.id];
      const active = booking.status !== "cancelled";
      return <div key={booking.id} className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{new Date(booking.startsAt).toLocaleString("de-DE")}</p><p className="mt-1 text-xs text-muted-foreground">{booking.guestName || "Gast"} · {booking.guestEmail || "Ohne Gast-E-Mail"} · {booking.status}</p><p className="mt-1 text-xs text-muted-foreground">Booking-ID: {booking.id}</p></div><div className="flex flex-wrap gap-2">{booking.meetingUrl && <a href={booking.meetingUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-sm">Meeting öffnen</a>}{active && <button type="button" disabled={loadingSlotsId === booking.id || mutatingId === booking.id} onClick={() => loadSlots(booking)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{loadingSlotsId === booking.id ? "Slots laden…" : slots ? "Slots aktualisieren" : "Umbuchen"}</button>}{active && <button type="button" disabled={mutatingId === booking.id} onClick={() => cancel(booking)} className="rounded-lg border px-3 py-2 text-sm text-destructive disabled:opacity-50">{mutatingId === booking.id ? "Verarbeitet…" : "Stornieren"}</button>}{retryable && <button type="button" disabled={retryingBookingId === booking.id} onClick={() => onRetrySync(booking.id)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{retryingBookingId === booking.id ? "Retry läuft…" : "Kalender-Sync erneut versuchen"}</button>}</div></div>
        {slots && active && <div className="mt-3 rounded-lg border bg-muted/20 p-3"><p className="mb-2 text-sm font-medium">Freie Slots der nächsten 14 Tage</p>{slots.length ? <><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{slots.map((slot) => <button key={slot.startsAt} type="button" onClick={() => setSelectedSlot((current) => ({ ...current, [booking.id]: slot.startsAt }))} className={`rounded-lg border p-3 text-left text-sm ${selectedSlot[booking.id] === slot.startsAt ? "border-foreground bg-muted" : "bg-background hover:bg-muted/50"}`}><span className="font-medium">{new Date(slot.startsAt).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><span className="mt-1 block text-xs text-muted-foreground">{slot.timezone}</span></button>)}</div><button type="button" disabled={!selectedSlot[booking.id] || mutatingId === booking.id} onClick={() => reschedule(booking)} className="mt-3 rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">Ausgewählten Slot übernehmen</button></> : <p className="text-sm text-muted-foreground">Aktuell sind keine freien Slots verfügbar.</p>}</div>}
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${syncClass(sync)}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{syncLabel(sync)}</span>{sync?.action && <span>{sync.action} · Versuch {sync.attempts}</span>}</div>{sync?.lastError && <p className="mt-1 break-words opacity-80">{sync.lastError}</p>}{sync?.nextAttemptAt && <p className="mt-1 opacity-70">Nächster automatischer Versuch: {new Date(sync.nextAttemptAt).toLocaleString("de-DE")}</p>}</div>
      </div>;
    }) : <p className="text-sm text-muted-foreground">Keine Buchungen entsprechen den aktuellen Filtern.</p>}</div>
  </section>;
}
