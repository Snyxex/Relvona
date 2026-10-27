"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Shift = { day: number; start: string; end: string };
type Schedule = { userId: string; timezone: string; weeklyShifts: Shift[]; backupUserId: string | null; autoRedistribute: boolean; maxOpenTickets: number | null };
type Absence = { id: string; userId: string; startsAt: string; endsAt: string; reason: string };
type Person = { userId: string; name: string; role: string; status: string; openTickets: number; capacity: number | null; teamIds: string[] };
const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const defaultShifts: Shift[] = [1, 2, 3, 4, 5].map(day => ({ day, start: "09:00", end: "17:00" }));

export default function SupportCoveragePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [selected, setSelected] = useState("");
  const [timezone, setTimezone] = useState("Europe/Berlin");
  const [shifts, setShifts] = useState<Shift[]>(defaultShifts);
  const [backup, setBackup] = useState("");
  const [redistribute, setRedistribute] = useState(true);
  const [capacity, setCapacity] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [reason, setReason] = useState("vacation");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    const [coverage, roster] = await Promise.all([
      api.get("/support-teams/coverage"), api.get("/support-teams/coverage/roster"),
    ]);
    setSchedules(coverage.data.schedules || []);
    setAbsences(coverage.data.absences || []);
    setPeople(roster.data || []);
    setSelected(current => current || roster.data?.[0]?.userId || "");
  }

  useEffect(() => { void reload().catch(() => setMessage("Arbeitszeitdaten konnten nicht geladen werden.")); }, []);
  useEffect(() => {
    if (!selected) return;
    const schedule = schedules.find(s => s.userId === selected);
    setTimezone(schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin");
    setShifts(schedule?.weeklyShifts || defaultShifts);
    setBackup(schedule?.backupUserId || "");
    setRedistribute(schedule?.autoRedistribute !== false);
    setCapacity(schedule?.maxOpenTickets == null ? "" : String(schedule.maxOpenTickets));
  }, [selected, schedules]);

  function changeDay(day: number, enabled: boolean) {
    setShifts(current => enabled
      ? [...current.filter(s => s.day !== day), { day, start: "09:00", end: "17:00" }]
      : current.filter(s => s.day !== day));
  }
  function changeShift(day: number, field: "start" | "end", value: string) {
    setShifts(current => current.map(s => s.day === day ? { ...s, [field]: value } : s));
  }
  async function saveSchedule() {
    if (!selected) return;
    setSaving(true); setMessage("");
    try {
      await api.put(`/support-teams/coverage/schedules/${selected}`, {
        timezone, weeklyShifts: shifts,
        backupUserId: backup || null, autoRedistribute: redistribute,
        maxOpenTickets: capacity === "" ? null : Number(capacity),
      });
      await reload(); setMessage("Arbeitszeiten gespeichert.");
    } catch (e: any) { setMessage(e.response?.data?.error || "Speichern fehlgeschlagen."); }
    finally { setSaving(false); }
  }
  async function addAbsence() {
    if (!selected || !starts || !ends) return;
    setSaving(true); setMessage("");
    try {
      await api.post("/support-teams/coverage/absences", {
        userId: selected, startsAt: new Date(starts).toISOString(),
        endsAt: new Date(ends).toISOString(), reason,
      });
      await reload(); setStarts(""); setEnds(""); setMessage("Abwesenheit eingetragen.");
    } catch (e: any) { setMessage(e.response?.data?.error || "Abwesenheit konnte nicht gespeichert werden."); }
    finally { setSaving(false); }
  }
  async function removeAbsence(id: string) {
    setSaving(true); setMessage("");
    try { await api.delete(`/support-teams/coverage/absences/${id}`); await reload(); setMessage("Abwesenheit entfernt."); }
    catch (e: any) { setMessage(e.response?.data?.error || "Löschen fehlgeschlagen."); }
    finally { setSaving(false); }
  }
  const chosen = people.find(p => p.userId === selected);
  const available = people.filter(p => p.status === "available").length;

  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-slate-100">
    <h1 className="text-2xl font-semibold">Arbeitszeiten & Vertretungen</h1>
    <p className="text-sm text-slate-400">Schichten, Urlaub, Krankheit, Kapazitätsgrenzen und automatische Vertretungen für Support-Teams verwalten.</p>
    {message && <p role="status" className="rounded border border-slate-700 p-3 text-sm">{message}</p>}
    <section className="rounded-xl border border-slate-700 p-5">
      <h2 className="mb-3 text-lg font-semibold">Aktuelle Team-Auslastung</h2>
      <p className="mb-3 text-sm text-slate-400">{available} von {people.length} aktiven Supportmitgliedern derzeit verfügbar</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[440px] text-left text-sm"><thead><tr className="border-b border-slate-700"><th className="py-2">Mitarbeiter</th><th>Status</th><th>Offene Tickets</th><th>Limit</th></tr></thead><tbody>
        {people.map(p => <tr key={p.userId} className="border-b border-slate-800"><td className="py-2">{p.name}</td><td>{({available:"Verfügbar",absent:"Abwesend",off_shift:"Außerhalb Schicht",offline:"Offline",at_capacity:"Ausgelastet"} as Record<string,string>)[p.status] || p.status}</td><td>{p.openTickets}</td><td>{p.capacity ?? "–"}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="space-y-5 rounded-xl border border-slate-700 p-5">
      <h2 className="text-lg font-semibold">Schichtplan</h2>
      <label className="block text-sm">Mitarbeiter<select className="mt-1 block w-full rounded bg-slate-900 p-2" value={selected} onChange={e => setSelected(e.target.value)}>
        {people.map(p => <option key={p.userId} value={p.userId}>{p.name} ({p.role})</option>)}
      </select></label>
      {chosen && <>
        <label className="block text-sm">Zeitzone (IANA)<input className="mt-1 block w-full rounded bg-slate-900 p-2" value={timezone} onChange={e => setTimezone(e.target.value)} /></label>
        <div className="space-y-2">{days.map((label, day) => {
          const shift = shifts.find(s => s.day === day);
          return <div className="flex flex-wrap items-center gap-3" key={day}>
            <label className="w-14 text-sm"><input className="mr-2" type="checkbox" checked={Boolean(shift)} onChange={e => changeDay(day, e.target.checked)}/>{label}</label>
            <input aria-label={`${label} Beginn`} type="time" disabled={!shift} value={shift?.start || "09:00"} onChange={e => changeShift(day,"start",e.target.value)} className="rounded bg-slate-900 p-2"/>
            <span>bis</span><input aria-label={`${label} Ende`} type="time" disabled={!shift} value={shift?.end || "17:00"} onChange={e => changeShift(day,"end",e.target.value)} className="rounded bg-slate-900 p-2"/>
          </div>;
        })}</div>
        <label className="block text-sm">Bevorzugte Vertretung<select className="mt-1 block w-full rounded bg-slate-900 p-2" value={backup} onChange={e => setBackup(e.target.value)}>
          <option value="">Automatisch auswählen</option>{people.filter(p => p.userId !== selected).map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
        </select></label>
        <label className="block text-sm">Maximale offene Tickets (leer = kein Limit)<input type="number" min="1" max="5000" value={capacity} onChange={e => setCapacity(e.target.value)} className="mt-1 block w-full rounded bg-slate-900 p-2"/></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={redistribute} onChange={e => setRedistribute(e.target.checked)}/>Offene Tickets bei Abwesenheit oder Schichtende neu zuweisen</label>
        <p className="text-xs text-slate-400">Schichten werden in der angegebenen Zeitzone interpretiert. Über-Nacht-Schichten bitte in zwei Tagesabschnitte aufteilen.</p>
        <button disabled={saving} onClick={() => void saveSchedule()} className="rounded bg-blue-600 px-4 py-2 disabled:opacity-50">Arbeitszeiten speichern</button>
      </>}
    </section>
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <h2 className="text-lg font-semibold">Urlaub und Abwesenheiten</h2>
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Beginn (Browser-Zeitzone)<input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} className="mt-1 w-full rounded bg-slate-900 p-2"/></label>
      <label className="text-sm">Ende (Browser-Zeitzone)<input type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} className="mt-1 w-full rounded bg-slate-900 p-2"/></label>
      <label className="text-sm">Grund<select value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded bg-slate-900 p-2"><option value="vacation">Urlaub</option><option value="sick">Krankheit</option><option value="other">Sonstiges</option></select></label></div>
      <button disabled={saving || !selected || !starts || !ends} onClick={() => void addAbsence()} className="rounded bg-blue-600 px-4 py-2 disabled:opacity-50">Abwesenheit eintragen</button>
      <div className="space-y-2">{absences.filter(a => a.userId === selected).map(a => <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 p-3 text-sm"><span>{a.reason} · {new Date(a.startsAt).toLocaleString("de-DE")} – {new Date(a.endsAt).toLocaleString("de-DE")}</span><button disabled={saving} onClick={() => void removeAbsence(a.id)} className="text-red-300">Entfernen</button></div>)}</div>
    </section>
  </main>;
}
