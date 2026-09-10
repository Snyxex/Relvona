"use client";

import { memo } from "react";
import { Bot, BrainCircuit, RefreshCw, Ticket, Users } from "lucide-react";

function AnalyticsTab({ overviewMetrics, onRefresh }: { overviewMetrics: any; onRefresh: () => void }) {
  const total = Math.max(overviewMetrics?.totalConversations || 0, 1);
  const resolutionRate = overviewMetrics?.resolutionRate ?? 0;
  const handoffs = overviewMetrics?.handoffs || 0;
  const cards = [
    ["Unterhaltungen", overviewMetrics?.totalConversations || 0, "text-blue-300", Bot],
    ["AI Resolution", `${resolutionRate}%`, "text-emerald-300", BrainCircuit],
    ["Human Handoffs", handoffs, "text-amber-300", Users],
    ["Offene Tickets", overviewMetrics?.openTickets || 0, "text-violet-300", Ticket],
  ] as const;

  return <div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Insights</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Analytics & Performance</h1><p className="mt-1 max-w-2xl text-sm text-slate-400">Verstehe Support-Last, Automatisierungsgrad und Wissensabdeckung auf einen Blick.</p></div><button type="button" onClick={onRefresh} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"><RefreshCw className="h-3.5 w-3.5" /> Aktualisieren</button></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, color, Icon]) => <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><div className="flex items-center justify-between"><p className="text-xs text-slate-400">{label}</p><Icon className="h-4 w-4 text-slate-500" /></div><p className={`mt-4 text-3xl font-semibold tracking-tight ${color}`}>{value}</p></div>)}</div>

    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs font-medium text-slate-400">AI Resolution</p><div className="mt-5 flex items-center gap-5"><div className="grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#43d3a0 ${Math.max(0, Math.min(100, resolutionRate)) * 3.6}deg, #172033 0deg)` }}><div className="grid h-16 w-16 place-items-center rounded-full bg-slate-900"><span className="text-lg font-semibold text-white">{resolutionRate}%</span></div></div><p className="text-xs leading-5 text-slate-400">Anteil der Gespräche, die ohne menschliche Übergabe gelöst wurden.</p></div></section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs font-medium text-slate-400">Human Workload</p><p className="mt-4 text-3xl font-semibold text-amber-300">{handoffs}</p><p className="mt-1 text-xs text-slate-500">Konversationen mit Agentenbedarf</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (handoffs / total) * 100)}%` }} /></div></section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs font-medium text-slate-400">Knowledge Readiness</p><p className="mt-4 text-3xl font-semibold text-blue-300">{overviewMetrics?.totalKnowledgeSources || 0}</p><p className="mt-1 text-xs text-slate-500">Quellen · {overviewMetrics?.totalDocumentChunks || 0} durchsuchbare Chunks</p><div className="mt-5 grid grid-cols-10 gap-1">{Array.from({ length: 10 }, (_, index) => <span key={index} className={`h-2 rounded-full ${index < Math.min(10, overviewMetrics?.totalKnowledgeSources || 0) ? "bg-blue-400" : "bg-slate-800"}`} />)}</div></section>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-sm font-semibold text-white">Conversation States</h2><div className="mt-4 space-y-3">{Object.entries(overviewMetrics?.stateBreakdown || {}).length ? Object.entries(overviewMetrics?.stateBreakdown || {}).map(([state, count]) => { const share = Math.round((Number(count) / total) * 100); return <div key={state}><div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="text-slate-400">{state.replaceAll("_", " ")}</span><span className="font-medium text-slate-300">{String(count)} · {share}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.max(2, share)}%` }} /></div></div>; }) : <p className="py-8 text-center text-xs text-slate-500">Noch keine Conversation-Daten vorhanden.</p>}</div></section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-sm font-semibold text-white">Erkannte Sprachen</h2><div className="mt-4 space-y-2">{overviewMetrics?.languageBreakdown?.length ? overviewMetrics.languageBreakdown.map((entry: any) => { const share = Math.round((entry.count / total) * 100); return <div key={entry.language} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5 text-xs"><span className="font-medium uppercase text-slate-300">{entry.language}</span><span className="text-slate-500">{entry.count} · {share}%</span></div>; }) : <p className="py-8 text-center text-xs text-slate-500">Noch keine Sprachdaten vorhanden.</p>}</div></section>
    </div>
  </div>;
}

export default memo(AnalyticsTab);
