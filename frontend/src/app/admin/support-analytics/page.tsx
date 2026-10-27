"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type SlaLine = { evaluated: number; met: number; breached: number; complianceRate: number | null; averageMinutes: number | null };
type Report = {
 generatedAt: string;
 range: { days: number; from: string; to: string; timezone: string };
 sla: { cohortTickets: number; trackedCases: number; firstResponse: SlaLine; resolution: SlaLine };
 tickets: { openedInRange: number; resolvedFromCohort: number; currentBacklog: number; unassigned: number; pending: number };
 daily: { day: string; arrivals: number; resolutions: number }[];
 teams: { id: string; name: string; enabled: boolean; members: number; availableMembers: number; activeTickets: number; pendingTickets: number }[];
 agents: { userId: string; name: string; role: string; teamIds: string[]; presence: string; available: boolean; activeTickets: number; pendingTickets: number; maxOpenTickets: number | null }[];
 forecast: { risk: "insufficient_data" | "no_coverage" | "high" | "moderate" | "low"; arrivalsLast14Days: number; resolutionsLast14Days: number; estimatedBacklogAfter7Days: number; averageDailyArrivals: number; averageDailyResolutions: number; availableAgents: number; disclaimer: string };
 definitions: { sla: string; teams: string; agents: string; daily: string };
};

const riskLabels: Record<Report["forecast"]["risk"], string> = {
 insufficient_data: "Zu wenig Daten", no_coverage: "Keine verfügbare Besetzung",
 high: "Hohes Engpassrisiko", moderate: "Erhöhte Auslastung", low: "Kein Engpassindikator",
};
const presenceLabels: Record<string,string> = {
 absent:"Abwesend",off_shift:"Außerhalb der Schicht",offline:"Offline",at_capacity:"Kapazitätsgrenze",available:"Verfügbar",
};
function pct(rate: number | null) { return rate === null ? "–" : `${(rate * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`; }
function mins(value: number | null) { return value === null ? "–" : `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Min.`; }
function formatDay(value: string) { return value.slice(5).split("-").reverse().join("."); }
function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
 return <article className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
   <h3 className="text-sm text-slate-300">{label}</h3>
   <p className="mt-2 text-2xl font-semibold">{value}</p>
   <p className="mt-2 text-xs text-slate-400">{detail}</p>
 </article>;
}
export default function SupportOperationsAnalyticsPage() {
 const [days, setDays] = useState(30);
 const [data, setData] = useState<Report | null>(null);
 const [error, setError] = useState("");
 const [loading, setLoading] = useState(true);
 const [refresh, setRefresh] = useState(0);
 useEffect(() => {
   let active = true;
   setLoading(true); setError("");
   void api.get(`/analytics/support-operations?days=${days}`).then(({data: result}) => {
     if(active) setData(result);
   }).catch((e) => {
     if(active) {setData(null);setError(e.response?.data?.error || "Support-Analytics konnten nicht geladen werden.");}
   }).finally(() => {if(active) setLoading(false);});
   return () => {active = false;};
 }, [days, refresh]);

 const last = data?.daily.slice(-30) || [];
 const maxBar = Math.max(1, ...last.flatMap(d => [d.arrivals, d.resolutions]));
 return <main className="mx-auto max-w-7xl space-y-7 p-4 text-slate-100 sm:p-8">
   <div className="flex flex-wrap items-end justify-between gap-4">
    <div><h1 className="text-2xl font-semibold">Support-Analytics</h1>
     <p className="mt-1 text-sm text-slate-400">SLA-Erfüllung, Auslastung, Tickettrends und indikative Personalengpässe</p></div>
    <div className="flex gap-3"><label className="text-sm text-slate-300">Zeitraum
      <select value={days} onChange={e=>setDays(Number(e.target.value))} className="ml-2 rounded border border-slate-600 bg-slate-900 p-2">
        <option value={7}>7 Tage</option><option value={30}>30 Tage</option><option value={90}>90 Tage</option><option value={365}>365 Tage</option>
      </select></label>
      <button onClick={()=>setRefresh(x=>x+1)} className="rounded border border-slate-600 px-3 py-2 text-sm">Aktualisieren</button>
    </div>
   </div>
   {loading&&<p role="status" className="text-sm text-slate-300">Auswertungen werden geladen ...</p>}
   {error&&<p role="alert" className="rounded border border-red-800 p-3 text-sm text-red-300">{error}</p>}
   {data&&!loading&&<>
    <p className="text-xs text-slate-400">Stand: {new Date(data.generatedAt).toLocaleString("de-DE")} · SLA-Kohorte: in diesem Zeitraum erstellte Tickets · Tageswerte in UTC</p>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
     <Metric label="SLA Erstantwort" value={pct(data.sla.firstResponse.complianceRate)} detail={`${data.sla.firstResponse.met} eingehalten / ${data.sla.firstResponse.evaluated} bewertbar`}/>
     <Metric label="SLA Lösung" value={pct(data.sla.resolution.complianceRate)} detail={`${data.sla.resolution.met} eingehalten / ${data.sla.resolution.evaluated} bewertbar`}/>
     <Metric label="Ø erste Antwort" value={mins(data.sla.firstResponse.averageMinutes)} detail="Nur Fälle mit erfasster Erstantwort"/>
     <Metric label="Ø Lösung" value={mins(data.sla.resolution.averageMinutes)} detail="Nur Fälle mit erfasstem Lösungszeitpunkt"/>
     <Metric label="Neue Tickets" value={data.tickets.openedInRange} detail={`${data.tickets.resolvedFromCohort} davon aktuell gelöst`}/>
     <Metric label="Aktueller Rückstand" value={data.tickets.currentBacklog} detail={`${data.tickets.pending} wartend · ${data.tickets.unassigned} ohne Zuweisung`}/>
     <Metric label="SLA-Abdeckung" value={`${data.sla.trackedCases}/${data.sla.cohortTickets}`} detail="Tickets mit gespeicherter SLA-Fallinformation"/>
     <Metric label="Verfügbare Mitarbeiter" value={data.forecast.availableAgents} detail="Aktueller Online-/Schicht-/Kapazitätsstatus"/>
    </section>
    <section className="rounded-xl border border-slate-700 p-5">
     <h2 className="text-lg font-semibold">Personalkapazität – indikative 7-Tage-Hochrechnung</h2>
     <p className="mt-2 text-sm font-medium">{riskLabels[data.forecast.risk]}</p>
     <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <Metric label="Neue Tickets / Tag" value={data.forecast.averageDailyArrivals} detail="Durchschnitt der letzten 14 Kalendertage"/>
      <Metric label="Gelöste Tickets / Tag" value={data.forecast.averageDailyResolutions} detail="Durchschnitt der letzten 14 Kalendertage"/>
      <Metric label="Geschätzter Rückstand +7 Tage" value={data.forecast.estimatedBacklogAfter7Days} detail={`Heute: ${data.tickets.currentBacklog} offene Tickets`}/>
     </div>
     <p className="mt-4 text-xs text-slate-400">{data.forecast.disclaimer}</p>
    </section>
    <section className="rounded-xl border border-slate-700 p-5">
     <h2 className="text-lg font-semibold">Ticket-Trend</h2>
     <p className="mb-5 text-xs text-slate-400">Bis zu 30 letzte Tage des gewählten Zeitraums · blaue Balken: neu, graue Balken: gelöst</p>
     <div className="overflow-x-auto"><div className="flex h-48 min-w-[620px] items-end gap-1">
      {last.map(day=><div key={day.day} title={`${day.day}: ${day.arrivals} neu, ${day.resolutions} gelöst`} className="flex min-w-0 flex-1 flex-col items-center justify-end">
       <div className="flex h-36 w-full items-end justify-center gap-0.5">
        <div className="w-[42%] rounded-t bg-blue-500" style={{height:`${day.arrivals/maxBar*100}%`}}/>
        <div className="w-[42%] rounded-t bg-slate-400" style={{height:`${day.resolutions/maxBar*100}%`}}/>
       </div>
       <span className="mt-2 w-full overflow-hidden text-center text-[9px] text-slate-400">{formatDay(day.day)}</span>
      </div>)}
     </div></div>
    </section>
    <section className="rounded-xl border border-slate-700 p-5">
     <h2 className="text-lg font-semibold">Teams – aktuelle Ticket-Auslastung</h2>
     <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[570px] text-left text-sm">
      <thead><tr className="border-b border-slate-700"><th className="py-2">Team</th><th>Mitglieder</th><th>Verfügbar</th><th>Aktive Tickets</th><th>Wartend</th></tr></thead>
      <tbody>{data.teams.map(t=><tr key={t.id} className="border-b border-slate-800"><td className="py-3">{t.name}{!t.enabled&&<span className="ml-2 text-xs text-slate-500">(deaktiviert)</span>}</td><td>{t.members}</td><td>{t.availableMembers}</td><td>{t.activeTickets}</td><td>{t.pendingTickets}</td></tr>)}</tbody>
     </table>{!data.teams.length&&<p className="py-3 text-sm text-slate-400">Noch keine Teams eingerichtet.</p>}</div>
    </section>
    <section className="rounded-xl border border-slate-700 p-5">
     <h2 className="text-lg font-semibold">Mitarbeiter – aktuell zugewiesene Tickets</h2>
     <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm">
      <thead><tr className="border-b border-slate-700"><th className="py-2">Mitarbeiter</th><th>Status</th><th>Offene Tickets</th><th>Davon wartend</th><th>Kapazität</th><th>Teams</th></tr></thead>
      <tbody>{data.agents.map(a=><tr key={a.userId} className="border-b border-slate-800">
       <td className="py-3">{a.name}</td><td>{presenceLabels[a.presence]||a.presence}</td><td>{a.activeTickets}</td>
       <td>{a.pendingTickets}</td><td>{a.maxOpenTickets ?? "Kein Limit"}</td>
       <td>{a.teamIds.map(id=>data.teams.find(t=>t.id===id)?.name).filter(Boolean).join(", ")||"–"}</td>
      </tr>)}</tbody>
     </table>{!data.agents.length&&<p className="py-3 text-sm text-slate-400">Keine aktiven Supportmitarbeiter vorhanden.</p>}</div>
    </section>
    <div className="space-y-2 text-xs text-slate-400"><p>{data.definitions.sla}</p><p>{data.definitions.teams}</p><p>{data.definitions.agents}</p><p>{data.definitions.daily}</p></div>
   </>}
 </main>;
}
