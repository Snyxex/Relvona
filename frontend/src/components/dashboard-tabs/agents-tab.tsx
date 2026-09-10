"use client";

import { memo } from "react";
import { ShieldCheck, UserRound } from "lucide-react";

function AgentsTab({ agents }: { agents: any[] }) {
  return <div className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Team</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Support Agents</h1><p className="mt-1 text-sm text-slate-400">Mitglieder, die eskalierte Kundenanfragen übernehmen können.</p></div><span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300">{agents.length} Agenten</span></div>
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-sm">
      {agents.length ? <div className="divide-y divide-slate-800">{agents.map((agent) => <div key={agent.id} className="flex flex-wrap items-center justify-between gap-4 p-4 transition hover:bg-slate-800/40"><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300"><UserRound className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{agent.name || "Unbenannter Agent"}</p><p className="truncate text-xs text-slate-500">{agent.email}</p></div></div><div className="flex items-center gap-2"><span className="rounded-full border border-slate-700 bg-slate-950/40 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-300">{agent.role}</span><span className="inline-flex items-center gap-1 rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2.5 py-1 text-[10px] font-semibold text-emerald-300"><ShieldCheck className="h-3 w-3" /> Aktiv</span></div></div>)}</div> : <div className="px-5 py-12 text-center"><UserRound className="mx-auto h-6 w-6 text-slate-600" /><p className="mt-3 text-sm font-medium text-slate-300">Noch keine Support-Agenten</p><p className="mt-1 text-xs text-slate-500">Füge Organisationsmitglieder mit der Rolle agent, admin oder owner hinzu.</p></div>}
    </section>
    <div className="rounded-xl border border-blue-900/50 bg-blue-950/20 p-4 text-xs leading-5 text-blue-200">Agenten können Unterhaltungen im Conversation Inbox übernehmen, beantworten und abschließen. Die tatsächlichen Rechte bleiben serverseitig rollenbasiert geschützt.</div>
  </div>;
}

export default memo(AgentsTab);
