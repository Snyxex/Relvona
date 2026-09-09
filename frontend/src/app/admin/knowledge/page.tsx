"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Health = { score: number; totalSources: number; counts: Record<string, number>; openGaps: number; gapOccurrences: number; factors: { code: string; count: number }[] };
type SourceIntelligence = {
  publicationStatus: string;
  health: string;
  priority: string;
  retrievalCount: number;
  answerUsageCount: number;
  recrawlEnabled: boolean;
  recrawlIntervalMinutes: number | null;
  nextCrawlAt: string | null;
  lastSuccessfulCrawlAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: string | null;
};
type SourceItem = { id: string; title: string; type: string; status: string; chunkCount: number; lastCrawledAt?: string | null; intelligence?: SourceIntelligence | null };
type Gap = { id: string; topic: string; summary: string; reason: string; severity: string; impactScore: number; occurrences: number; status: string; lastSeenAt: string };
type FaqDraft = { id: string; question: string; answer: string; reviewStatus: string; confidence: number | null; updatedAt: string };
type SourceDraft = { publicationStatus: string; priority: string; recrawlEnabled: boolean; recrawlIntervalMinutes: number };

const RECRAWL_PRESETS = [
  { value: 60, label: "Stündlich" },
  { value: 360, label: "Alle 6 Stunden" },
  { value: 720, label: "Alle 12 Stunden" },
  { value: 1440, label: "Täglich" },
  { value: 10080, label: "Wöchentlich" },
  { value: 43200, label: "Alle 30 Tage" },
];

export default function KnowledgeIntelligencePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [drafts, setDrafts] = useState<FaqDraft[]>([]);
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, SourceDraft>>({});
  const [savingSourceId, setSavingSourceId] = useState<string | null>(null);
  const [sourceMessage, setSourceMessage] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
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
      const loadedSources: SourceItem[] = sourceResponse.data.items || [];
      setHealth(healthResponse.data);
      setSources(loadedSources);
      setSourceDrafts(Object.fromEntries(loadedSources.map((source) => [source.id, {
        publicationStatus: source.intelligence?.publicationStatus || "PUBLISHED",
        priority: source.intelligence?.priority || "NORMAL",
        recrawlEnabled: Boolean(source.intelligence?.recrawlEnabled),
        recrawlIntervalMinutes: source.intelligence?.recrawlIntervalMinutes || 1440,
      }])));
      setGaps(gapResponse.data || []);
      setDrafts(draftResponse.data || []);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || requestError?.response?.data?.error || "Knowledge Intelligence konnte nicht geladen werden.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const changedSourceIds = useMemo(() => new Set(sources.filter((source) => {
    const draft = sourceDrafts[source.id];
    if (!draft) return false;
    return draft.publicationStatus !== (source.intelligence?.publicationStatus || "PUBLISHED")
      || draft.priority !== (source.intelligence?.priority || "NORMAL")
      || (source.type === "website" && (draft.recrawlEnabled !== Boolean(source.intelligence?.recrawlEnabled)
        || draft.recrawlIntervalMinutes !== (source.intelligence?.recrawlIntervalMinutes || 1440)));
  }).map((source) => source.id)), [sources, sourceDrafts]);

  async function saveSource(source: SourceItem) {
    const draft = sourceDrafts[source.id];
    if (!draft) return;
    setSavingSourceId(source.id);
    setSourceMessage((current) => ({ ...current, [source.id]: { type: "success", text: "" } }));
    try {
      await api.patch(`/knowledge-intelligence/sources/${source.id}`, {
        publicationStatus: draft.publicationStatus,
        priority: draft.priority,
        ...(source.type === "website" ? {
          recrawlEnabled: draft.recrawlEnabled,
          recrawlIntervalMinutes: draft.recrawlEnabled ? draft.recrawlIntervalMinutes : null,
        } : {}),
      });
      setSourceMessage((current) => ({ ...current, [source.id]: { type: "success", text: "Einstellungen gespeichert." } }));
      await load();
    } catch (requestError: any) {
      const text = requestError?.response?.status === 403
        ? "Nur Owner und Admins dürfen diese Einstellungen ändern."
        : requestError?.response?.data?.error?.message || requestError?.response?.data?.error || "Einstellungen konnten nicht gespeichert werden.";
      setSourceMessage((current) => ({ ...current, [source.id]: { type: "error", text } }));
    } finally { setSavingSourceId(null); }
  }

  if (loading) return <main className="p-4 text-slate-200 sm:p-6 lg:p-8"><p role="status">Knowledge Intelligence wird geladen …</p></main>;
  if (error) return <main className="p-4 text-slate-200 sm:p-6 lg:p-8"><h1 className="text-2xl font-bold">Knowledge Intelligence</h1><p role="alert" className="mt-4 text-red-300">{error}</p><button className="mt-4 rounded bg-blue-600 px-4 py-2" onClick={() => { void load(); }}>Erneut versuchen</button></main>;

  return <main className="min-w-0 space-y-6 p-4 text-slate-100 sm:p-6 lg:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Knowledge Intelligence</h1><p className="mt-1 text-sm text-slate-400">Gesundheit, Freigabe, automatische Recrawls, Wissenslücken und Retrieval-Nutzung.</p></div><button className="rounded border border-slate-700 px-3 py-2 text-sm" onClick={() => { void load(); }}>Aktualisieren</button></div>

    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Health Score" value={`${health?.score ?? 0}/100`} />
      <Metric label="Quellen" value={String(health?.totalSources ?? 0)} />
      <Metric label="Offene Gaps" value={String(health?.openGaps ?? 0)} />
      <Metric label="Gap-Vorkommen" value={String(health?.gapOccurrences ?? 0)} />
    </section>

    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">Health-Faktoren</h2><div className="mt-3 flex flex-wrap gap-2">{health?.factors.length ? health.factors.map((factor) => <span key={factor.code} className="rounded-full bg-slate-800 px-3 py-1 text-xs">{factor.code}: {factor.count}</span>) : <span className="text-sm text-emerald-300">Keine negativen Health-Faktoren erkannt.</span>}</div></section>

    <section className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 p-4"><h2 className="font-semibold">Quellen & Recrawl-Steuerung</h2><p className="mt-1 text-xs text-slate-400">Freigabe und Priorität gelten für alle Quellen. Automatische Recrawls stehen nur für Websites zur Verfügung.</p></div>
      <div className="divide-y divide-slate-800">
        {sources.map((source) => {
          const draft = sourceDrafts[source.id];
          const message = sourceMessage[source.id];
          if (!draft) return null;
          return <article key={source.id} className="space-y-4 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0"><h3 className="break-words font-medium">{source.title}</h3><p className="mt-1 text-xs text-slate-500">{source.type} · {source.chunkCount} Chunks · Verarbeitung: {source.status}</p></div>
              <div className="flex flex-wrap gap-2 text-xs"><StatusPill label={`Health: ${source.intelligence?.health || source.status}`} /><StatusPill label={`${source.intelligence?.retrievalCount || 0} Retrievals`} /><StatusPill label={`${source.intelligence?.answerUsageCount || 0} Antworten`} /></div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-slate-400">Freigabe<select className="mt-1 block min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" value={draft.publicationStatus} onChange={(event) => setSourceDrafts((current) => ({ ...current, [source.id]: { ...current[source.id], publicationStatus: event.target.value } }))}><option value="DRAFT">DRAFT</option><option value="PUBLISHED">PUBLISHED</option><option value="ARCHIVED">ARCHIVED</option></select></label>
              <label className="text-xs text-slate-400">Priorität<select className="mt-1 block min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" value={draft.priority} onChange={(event) => setSourceDrafts((current) => ({ ...current, [source.id]: { ...current[source.id], priority: event.target.value } }))}><option value="LOW">LOW</option><option value="NORMAL">NORMAL</option><option value="HIGH">HIGH</option><option value="AUTHORITATIVE">AUTHORITATIVE</option></select></label>
              {source.type === "website" ? <>
                <label className="flex min-h-11 items-center gap-3 rounded border border-slate-700 bg-slate-950 px-3 text-sm"><input type="checkbox" checked={draft.recrawlEnabled} onChange={(event) => setSourceDrafts((current) => ({ ...current, [source.id]: { ...current[source.id], recrawlEnabled: event.target.checked } }))} /><span>Automatischer Recrawl</span></label>
                <label className="text-xs text-slate-400">Intervall<select disabled={!draft.recrawlEnabled} className="mt-1 block min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 disabled:opacity-50" value={draft.recrawlIntervalMinutes} onChange={(event) => setSourceDrafts((current) => ({ ...current, [source.id]: { ...current[source.id], recrawlIntervalMinutes: Number(event.target.value) } }))}>{RECRAWL_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
              </> : <div className="sm:col-span-2 xl:col-span-2"><p className="text-xs text-slate-500">Kein Recrawl für diesen Quellentyp.</p></div>}
            </div>

            {source.type === "website" && <div className="grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-3"><p>Letzter Crawl: {formatDate(source.lastCrawledAt)}</p><p>Nächster Crawl: {draft.recrawlEnabled ? formatDate(source.intelligence?.nextCrawlAt) : "deaktiviert"}</p><p>Letzter Erfolg: {formatDate(source.intelligence?.lastSuccessfulCrawlAt)}</p>{source.intelligence?.lastFailureAt && <p className="sm:col-span-3 text-amber-300">Letzter Fehler: {formatDate(source.intelligence.lastFailureAt)} · {source.intelligence.lastFailureCategory || "unbekannt"}</p>}</div>}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><button type="button" disabled={!changedSourceIds.has(source.id) || savingSourceId !== null} className="min-h-11 rounded bg-blue-600 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { void saveSource(source); }}>{savingSourceId === source.id ? "Speichert …" : "Einstellungen speichern"}</button>{message?.text && <p role={message.type === "error" ? "alert" : "status"} className={message.type === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>{message.text}</p>}</div>
          </article>;
        })}
        {!sources.length && <p className="p-6 text-sm text-slate-400">Keine Wissensquellen vorhanden.</p>}
      </div>
    </section>

    <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">Knowledge Gaps</h2><div className="mt-3 space-y-3">{gaps.map((gap) => <article key={gap.id} className="rounded-lg bg-slate-800/60 p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{gap.topic}</strong><span className="text-xs text-amber-300">{gap.status} · Impact {gap.impactScore}</span></div><p className="mt-1 text-sm text-slate-300">{gap.summary}</p><p className="mt-2 text-xs text-slate-500">{gap.reason} · {gap.occurrences} Vorkommen</p></article>)}{!gaps.length && <p className="text-sm text-slate-400">Keine Knowledge Gaps vorhanden.</p>}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">FAQ Review</h2><div className="mt-3 space-y-3">{drafts.map((draft) => <article key={draft.id} className="rounded-lg bg-slate-800/60 p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{draft.question}</strong><span className="text-xs text-blue-300">{draft.reviewStatus}</span></div><p className="mt-1 line-clamp-3 text-sm text-slate-300">{draft.answer}</p>{draft.confidence !== null && <p className="mt-2 text-xs text-slate-500">Confidence: {Math.round(draft.confidence * 100)}%</p>}</article>)}{!drafts.length && <p className="text-sm text-slate-400">Keine FAQ-Entwürfe zur Prüfung.</p>}</div></div>
    </section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>;
}

function StatusPill({ label }: { label: string }) {
  return <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-300">{label}</span>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
