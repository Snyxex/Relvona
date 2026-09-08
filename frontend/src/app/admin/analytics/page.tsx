"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Metrics = {
  range: { days: number; from: string; to: string };
  conversations: { total: number; resolved: number; waitingForAgent: number; agentActive: number; resolutionRate: number };
  handoffs: { total: number; rate: number };
  tickets: { total: number; open: number; resolved: number };
  feedback: { positive: number; negative: number; satisfactionRate: number | null };
  knowledgeGaps: { open: number; occurrences: number };
};

type KnowledgeGap = {
  id: string;
  topic: string;
  summary: string;
  status: string;
  occurrences: number;
  lastSeenAt: string;
};

function percent(value: number | null) {
  return value === null ? "–" : `${Math.round(value * 100)} %`;
}

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [topic, setTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setError("");
    try {
      const [metricsResult, gapsResult] = await Promise.all([
        api.get(`/analytics/support?days=${days}`),
        api.get("/analytics/knowledge-gaps?limit=100"),
      ]);
      setMetrics(metricsResult.data);
      setGaps(gapsResult.data);
    } catch (e: any) {
      setError(e.response?.data?.error || "Analytics konnten nicht geladen werden.");
    }
  }

  useEffect(() => { void load(); }, [days]);

  async function createGap(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      await api.post("/analytics/knowledge-gaps", { topic, summary, metadata: { source: "admin_manual" } });
      setTopic(""); setSummary(""); await load();
    } catch (e: any) {
      setError(e.response?.data?.error || "Knowledge Gap konnte nicht gespeichert werden.");
    } finally { setLoading(false); }
  }

  async function setStatus(id: string, status: "open" | "acknowledged" | "resolved" | "ignored") {
    setError("");
    try { await api.patch(`/analytics/knowledge-gaps/${id}`, { status }); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Knowledge Gap konnte nicht aktualisiert werden."); }
  }

  return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-muted-foreground">Support Operations</p><h1 className="text-2xl font-semibold">Analytics & Knowledge Gaps</h1><p className="mt-2 text-sm text-muted-foreground">Supportqualität, Eskalationen und fehlendes Wissen im Blick behalten.</p></div><label className="text-sm">Zeitraum<select value={days} onChange={(e) => setDays(Number(e.target.value))} className="ml-2 rounded-lg border bg-background px-3 py-2"><option value={7}>7 Tage</option><option value={30}>30 Tage</option><option value={90}>90 Tage</option></select></label></div>
    {error && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}

    {metrics && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      <Stat title="Conversations" value={metrics.conversations.total} subtitle={`${metrics.conversations.resolved} gelöst`} />
      <Stat title="Resolution Rate" value={percent(metrics.conversations.resolutionRate)} subtitle="im Zeitraum" />
      <Stat title="Handoff Rate" value={percent(metrics.handoffs.rate)} subtitle={`${metrics.handoffs.total} Übergaben`} />
      <Stat title="Offene Tickets" value={metrics.tickets.open} subtitle={`${metrics.tickets.resolved} gelöst`} />
      <Stat title="Zufriedenheit" value={percent(metrics.feedback.satisfactionRate)} subtitle={`${metrics.feedback.positive} positiv · ${metrics.feedback.negative} negativ`} />
      <Stat title="Knowledge Gaps" value={metrics.knowledgeGaps.open} subtitle={`${metrics.knowledgeGaps.occurrences} Vorkommen`} />
    </section>}

    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Knowledge Gap erfassen</h2><p className="mt-1 text-sm text-muted-foreground">Nur das fehlende Wissensgebiet zusammenfassen; personenbezogene Daten werden serverseitig nochmals redigiert.</p><form onSubmit={createGap} className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]"><input required value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Thema, z. B. SSO-Einrichtung" className="rounded-lg border bg-background px-3 py-2 text-sm" /><input required value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Welche Information fehlt?" className="rounded-lg border bg-background px-3 py-2 text-sm" /><button disabled={loading} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{loading ? "Speichert…" : "Erfassen"}</button></form></section>

    <section className="rounded-xl border bg-card p-5"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">Knowledge Gaps</h2><span className="text-xs text-muted-foreground">nach Häufigkeit sortiert</span></div><div className="space-y-3">{gaps.length ? gaps.map((gap) => <div key={gap.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{gap.topic}</p><span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{gap.status}</span><span className="text-xs text-muted-foreground">{gap.occurrences}×</span></div><p className="mt-2 text-sm text-muted-foreground">{gap.summary}</p><p className="mt-2 text-xs text-muted-foreground">Zuletzt gesehen: {new Date(gap.lastSeenAt).toLocaleString("de-DE")}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setStatus(gap.id, "acknowledged")} className="rounded-lg border px-3 py-1.5 text-xs">Bestätigen</button><button onClick={() => setStatus(gap.id, "resolved")} className="rounded-lg border px-3 py-1.5 text-xs">Gelöst</button><button onClick={() => setStatus(gap.id, "ignored")} className="rounded-lg border px-3 py-1.5 text-xs">Ignorieren</button><button onClick={() => setStatus(gap.id, "open")} className="rounded-lg border px-3 py-1.5 text-xs">Öffnen</button></div></div></div>) : <p className="text-sm text-muted-foreground">Noch keine Knowledge Gaps erfasst.</p>}</div></section>
  </main>;
}

function Stat({ title, value, subtitle }: { title: string; value: number | string; subtitle: string }) {
  return <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-3xl font-semibold">{value}</p><p className="mt-2 text-xs text-muted-foreground">{subtitle}</p></div>;
}
