"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Health = { score: number; totalSources: number; counts: Record<string, number>; openGaps: number; gapOccurrences: number; factors: { code: string; count: number }[] };
type SourceItem = { id: string; title: string; type: string; status: string; chunkCount: number; intelligence?: { publicationStatus: string; health: string; priority: string; retrievalCount: number; answerUsageCount: number } | null };
type Gap = { id: string; topic: string; summary: string; reason: string; severity: string; impactScore: number; occurrences: number; status: string; lastSeenAt: string };
type FaqDraft = { id: string; question: string; answer: string; reviewStatus: string; confidence: number | null; updatedAt: string };

export default function KnowledgeIntelligencePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [drafts, setDrafts] = useState<FaqDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [healthResponse, sourceResponse, gapResponse, draftResponse] = await Promise.all([
        api.get("/knowledge-intelligence/health"),
        api.get("/knowledge-intelligence/sources", { params: { limit: 50 } }),
        api.get("/knowledge-intelligence/gaps", { params: { limit: 20 } }),
        api.get("/knowledge-intelligence/faq-drafts", { params: { limit: 20 } }),
      ]);
      setHealth(healthResponse.data);
      setSources(sourceResponse.data.items || []);
      setGaps(gapResponse.data || []);
      setDrafts(draftResponse.data || []);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || requestError?.response?.data?.error || "Knowledge Intelligence konnte nicht geladen werden.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <main className="p-4 text-slate-200 sm:p-6 lg:p-8"><p role="status">Knowledge Intelligence wird geladen …</p></main>;
  if (error) return <main className="p-4 text-slate-200 sm:p-6 lg:p-8"><h1 className="text-2xl font-bold">Knowledge Intelligence</h1><p role="alert" className="mt-4 text-red-300">{error}</p><button className="mt-4 rounded bg-blue-600 px-4 py-2" onClick={() => { void load(); }}>Erneut versuchen</button></main>;

  return <main className="min-w-0 space-y-6 p-4 text-slate-100 sm:p-6 lg:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Knowledge Intelligence</h1><p className="mt-1 text-sm text-slate-400">Gesundheit, Wissenslücken, Retrieval-Nutzung und FAQ-Review.</p></div><button className="rounded border border-slate-700 px-3 py-2 text-sm" onClick={() => { void load(); }}>Aktualisieren</button></div>

    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Health Score" value={`${health?.score ?? 0}/100`} />
      <Metric label="Quellen" value={String(health?.totalSources ?? 0)} />
      <Metric label="Offene Gaps" value={String(health?.openGaps ?? 0)} />
      <Metric label="Gap-Vorkommen" value={String(health?.gapOccurrences ?? 0)} />
    </section>

    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">Health-Faktoren</h2><div className="mt-3 flex flex-wrap gap-2">{health?.factors.length ? health.factors.map((factor) => <span key={factor.code} className="rounded-full bg-slate-800 px-3 py-1 text-xs">{factor.code}: {factor.count}</span>) : <span className="text-sm text-emerald-300">Keine negativen Health-Faktoren erkannt.</span>}</div></section>

    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><div className="border-b border-slate-800 p-4"><h2 className="font-semibold">Quellenzustand</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-800/80 text-slate-400"><tr><th className="p-3">Quelle</th><th className="p-3">Health</th><th className="p-3">Freigabe</th><th className="p-3">Priorität</th><th className="p-3">Retrievals</th><th className="p-3">Antworten</th></tr></thead><tbody className="divide-y divide-slate-800">{sources.map((source) => <tr key={source.id}><td className="p-3"><p className="font-medium">{source.title}</p><p className="text-xs text-slate-500">{source.type} · {source.chunkCount} Chunks</p></td><td className="p-3">{source.intelligence?.health || source.status}</td><td className="p-3">{source.intelligence?.publicationStatus || "Legacy/PUBLISHED"}</td><td className="p-3">{source.intelligence?.priority || "NORMAL"}</td><td className="p-3">{source.intelligence?.retrievalCount || 0}</td><td className="p-3">{source.intelligence?.answerUsageCount || 0}</td></tr>)}{!sources.length && <tr><td colSpan={6} className="p-6 text-slate-400">Keine Wissensquellen vorhanden.</td></tr>}</tbody></table></div></section>

    <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">Knowledge Gaps</h2><div className="mt-3 space-y-3">{gaps.map((gap) => <article key={gap.id} className="rounded-lg bg-slate-800/60 p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{gap.topic}</strong><span className="text-xs text-amber-300">{gap.status} · Impact {gap.impactScore}</span></div><p className="mt-1 text-sm text-slate-300">{gap.summary}</p><p className="mt-2 text-xs text-slate-500">{gap.reason} · {gap.occurrences} Vorkommen</p></article>)}{!gaps.length && <p className="text-sm text-slate-400">Keine Knowledge Gaps vorhanden.</p>}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">FAQ Review</h2><div className="mt-3 space-y-3">{drafts.map((draft) => <article key={draft.id} className="rounded-lg bg-slate-800/60 p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{draft.question}</strong><span className="text-xs text-blue-300">{draft.reviewStatus}</span></div><p className="mt-1 line-clamp-3 text-sm text-slate-300">{draft.answer}</p>{draft.confidence !== null && <p className="mt-2 text-xs text-slate-500">Confidence: {Math.round(draft.confidence * 100)}%</p>}</article>)}{!drafts.length && <p className="text-sm text-slate-400">Keine FAQ-Entwürfe zur Prüfung.</p>}</div></div>
    </section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>;
}
