"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type MeetingType = { id: string; name: string };
type AvailabilityRule = { id: string; meetingTypeId?: string | null; weekday: number; startMinute: number; endMinute: number; timezone: string; enabled: boolean };
type Draft = Pick<AvailabilityRule, "meetingTypeId" | "weekday" | "startMinute" | "endMinute" | "timezone" | "enabled">;

const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function minuteToTime(value: number) {
  const hours = Math.floor(value / 60).toString().padStart(2, "0");
  const minutes = (value % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeToMinute(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function AvailabilityEditor({ meetingTypes }: { meetingTypes: MeetingType[] }) {
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [timezone, setTimezone] = useState("Europe/Berlin");
  const [meetingTypeId, setMeetingTypeId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/scheduling/availability");
      const next: AvailabilityRule[] = data;
      setRules(next);
      setDrafts(Object.fromEntries(next.map((rule) => [rule.id, {
        meetingTypeId: rule.meetingTypeId || null,
        weekday: rule.weekday,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        timezone: rule.timezone,
        enabled: rule.enabled,
      }])));
    } catch (e: any) { setError(e.response?.data?.error || "Verfügbarkeiten konnten nicht geladen werden."); }
  }

  useEffect(() => { void load(); }, []);

  async function createRule(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy("new");
    try {
      await api.post("/scheduling/availability", {
        meetingTypeId: meetingTypeId || undefined,
        weekday,
        startMinute: timeToMinute(start),
        endMinute: timeToMinute(end),
        timezone,
      });
      await load();
    } catch (e: any) { setError(e.response?.data?.error || "Verfügbarkeit konnte nicht erstellt werden."); }
    finally { setBusy(null); }
  }

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function saveRule(id: string) {
    const draft = drafts[id]; if (!draft) return;
    setBusy(id); setError("");
    try {
      await api.patch(`/scheduling/availability/${id}`, { ...draft, meetingTypeId: draft.meetingTypeId || null });
      await load();
    } catch (e: any) { setError(e.response?.data?.error || "Verfügbarkeit konnte nicht gespeichert werden."); }
    finally { setBusy(null); }
  }

  async function deleteRule(id: string) {
    if (!window.confirm("Diese Verfügbarkeitsregel wirklich löschen?")) return;
    setBusy(id); setError("");
    try { await api.delete(`/scheduling/availability/${id}`); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Verfügbarkeit konnte nicht gelöscht werden."); }
    finally { setBusy(null); }
  }

  return <section className="rounded-xl border bg-card p-5">
    <h2 className="font-semibold">Verfügbarkeiten</h2>
    <p className="mt-1 text-sm text-muted-foreground">Globale Regeln gelten für alle Terminarten; optional kann eine Regel auf einen Meeting Type begrenzt werden.</p>
    {error && <div className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}
    <form onSubmit={createRule} className="mt-4 grid gap-3 md:grid-cols-6">
      <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">{weekdays.map((label, index) => <option key={label} value={index}>{label}</option>)}</select>
      <input type="time" value={start} onChange={(event) => setStart(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm" />
      <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm" />
      <input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Europe/Berlin" />
      <select value={meetingTypeId} onChange={(event) => setMeetingTypeId(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="">Alle Meeting Types</option>{meetingTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
      <button disabled={busy === "new"} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{busy === "new" ? "Speichert…" : "Hinzufügen"}</button>
    </form>
    <div className="mt-4 space-y-3">{rules.length ? rules.map((rule) => {
      const draft = drafts[rule.id]; if (!draft) return null;
      return <div key={rule.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_1fr_1.2fr_1.4fr_auto] md:items-center">
        <select value={draft.weekday} onChange={(event) => updateDraft(rule.id, { weekday: Number(event.target.value) })} className="rounded-lg border bg-background px-3 py-2 text-sm">{weekdays.map((label, index) => <option key={label} value={index}>{label}</option>)}</select>
        <input type="time" value={minuteToTime(draft.startMinute)} onChange={(event) => updateDraft(rule.id, { startMinute: timeToMinute(event.target.value) })} className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <input type="time" value={minuteToTime(draft.endMinute)} onChange={(event) => updateDraft(rule.id, { endMinute: timeToMinute(event.target.value) })} className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <input value={draft.timezone} onChange={(event) => updateDraft(rule.id, { timezone: event.target.value })} className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <select value={draft.meetingTypeId || ""} onChange={(event) => updateDraft(rule.id, { meetingTypeId: event.target.value || null })} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="">Alle Meeting Types</option>{meetingTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
        <div className="flex items-center gap-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(rule.id, { enabled: event.target.checked })} />aktiv</label><button type="button" disabled={busy === rule.id} onClick={() => saveRule(rule.id)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50">Speichern</button><button type="button" disabled={busy === rule.id} onClick={() => deleteRule(rule.id)} className="rounded-lg border px-3 py-2 text-xs text-destructive disabled:opacity-50">Löschen</button></div>
      </div>;
    }) : <p className="text-sm text-muted-foreground">Noch keine Verfügbarkeitsregeln.</p>}</div>
  </section>;
}
