"use client";

import { memo } from "react";
import { Mail, UserRound } from "lucide-react";

function CustomersTab({ customers }: { customers: any[] }) {
  return <div className="mx-auto max-w-6xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Customers</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Customer Directory</h1><p className="mt-1 text-sm text-slate-400">Kundenprofile aus Widget-Sessions und verknüpften Support-Konversationen.</p></div><span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300">{customers.length} Kunden</span></div>
    <section className="rounded-2xl border border-slate-800 bg-slate-900 shadow-sm">
      {customers.length ? <div className="grid gap-px overflow-hidden rounded-2xl bg-slate-800 sm:grid-cols-2 xl:grid-cols-3">{customers.map((customer) => <article key={customer.id} className="min-w-0 bg-slate-900 p-4 transition hover:bg-slate-800/50"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300"><UserRound className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{customer.name || "Website visitor"}</p><div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{customer.email || "Keine E-Mail"}</span></div></div></div><div className="mt-4 space-y-1.5 border-t border-slate-800 pt-3 text-[11px] text-slate-500"><div className="flex justify-between gap-3"><span>External ID</span><span className="max-w-[65%] truncate font-mono text-slate-400">{customer.externalId || "—"}</span></div><div className="flex justify-between gap-3"><span>Erstellt</span><span className="text-slate-400">{new Date(customer.createdAt).toLocaleDateString("de-DE")}</span></div></div></article>)}</div> : <div className="px-5 py-14 text-center"><UserRound className="mx-auto h-6 w-6 text-slate-600" /><p className="mt-3 text-sm font-medium text-slate-300">Noch keine Kundenprofile</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">Sobald ein Besucher eine Widget-Session startet, erscheint das Kundenprofil automatisch hier.</p></div>}
    </section>
  </div>;
}

export default memo(CustomersTab);
