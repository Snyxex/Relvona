"use client";

import { memo } from "react";
import { BookOpen, Bot, CheckCircle2, MessageSquare, Ticket, Users } from "lucide-react";

function MetricCard({ label, value, hint, icon: Icon, accent = "text-blue-300" }: { label: string; value: string | number; hint: string; icon: any; accent?: string }) {
  return <div className="group rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-700">
    <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-slate-400">{label}</span><span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-800 text-slate-300"><Icon className="h-4 w-4" /></span></div>
    <p className={`mt-4 text-3xl font-semibold tracking-tight ${accent}`}>{value}</p>
    <p className="mt-1 text-[11px] leading-5 text-slate-500">{hint}</p>
  </div>;
}

function OverviewTab({ overviewMetrics }: { overviewMetrics: any }) {
  const unanswered = overviewMetrics?.unansweredQuestions || [];
  return <div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Workspace</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Support im Überblick</h1><p className="mt-1 max-w-2xl text-sm text-slate-400">Live-Zustand von AI Support, Agenten-Eskalationen, Tickets und Wissensbasis.</p></div>
      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-900/70 bg-emerald-950/35 px-3 py-1.5 text-xs font-medium text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Tenant-Isolation aktiv</div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Unterhaltungen" value={overviewMetrics?.totalConversations || 0} hint="Gesamte Support-Konversationen" icon={MessageSquare} />
      <MetricCard label="AI Resolution Rate" value={`${overviewMetrics?.resolutionRate ?? 0}%`} hint="Ohne menschliche Übergabe gelöst" icon={Bot} accent="text-emerald-300" />
      <MetricCard label="Human Handoffs" value={overviewMetrics?.handoffs || 0} hint="Benötigen menschliche Aufmerksamkeit" icon={Users} accent="text-amber-300" />
      <MetricCard label="Offene Tickets" value={overviewMetrics?.openTickets || 0} hint="Aktive Kundenanfragen" icon={Ticket} accent="text-violet-300" />
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-white">Knowledge Readiness</h2><p className="mt-1 text-xs text-slate-500">Verfügbare Grundlage für Retrieval und Antworten.</p></div><BookOpen className="h-4 w-4 text-blue-300" /></div>
        <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><p className="text-xs text-slate-500">Quellen</p><p className="mt-1 text-2xl font-semibold text-white">{overviewMetrics?.totalKnowledgeSources || 0}</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><p className="text-xs text-slate-500">Vektor-Chunks</p><p className="mt-1 text-2xl font-semibold text-blue-300">{overviewMetrics?.totalDocumentChunks || 0}</p></div></div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-white">Fragen mit Aufmerksamkeit</h2><p className="mt-1 text-xs text-slate-500">Neueste unbeantwortete oder unsichere Anfragen.</p></div><span className="rounded-full bg-amber-950/70 px-2.5 py-1 text-[10px] font-semibold text-amber-300">{unanswered.length} offen</span></div>
        <div className="mt-4 space-y-2">{unanswered.length ? unanswered.slice(0, 6).map((q: any) => <div key={q.id} className="rounded-xl border border-slate-800 bg-slate-950/35 px-3.5 py-3 text-xs leading-5 text-slate-300">{q.question}</div>) : <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center"><CheckCircle2 className="mx-auto h-5 w-5 text-emerald-300" /><p className="mt-2 text-sm font-medium text-slate-300">Aktuell nichts offen</p><p className="mt-1 text-xs text-slate-500">Es wurden keine unbeantworteten Fragen erkannt.</p></div>}</div>
      </section>
    </div>
  </div>;
}

export default memo(OverviewTab);
