"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Health = { score: number; totalSources: number; openGaps: number; gapOccurrences: number; factors: { code: string; count: number }[] };
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
type SourceDraft = { publicationStatus: string; priority: string; recrawlEnabled: boolean; recrawlIntervalMinutes: number };
type Gap = { id: string; topic: string; summary: string; reason: string; impactScore: number; occurrences: number; status: string };
type FaqDraft = { id: string; question: string; answer: string; reviewStatus: string; confidence: number | null };
type Collection = { id: string; name: string; description: string | null; sourceCount: number; assistantCount: number; sourceIds: string[]; assistantIds: string[] };
type Assistant = { id: string; name: string };
type Flash = { type: "success" | "error"; text: string };

const RECRAWL_PRESETS = [
  { value: 60, label: "Stündlich" },
  { value: 360, label: "Alle 6 Stunden" },
  { value: 720, label: "Alle 12 Stunden" },
  { value: 1440, label: "Täglich" },
  { value: 10080, label: "Wöchentlich" },
  { value: 43200, label: "Alle 30 Tage" },
];

function errorText(error: any, fallback: string) {
  if (error?.response?.status === 403) return "Nur Owner und Admins dürfen diese Einstellung ändern.";
  return error?.response?.data?.error?.message || error?.response?.data?.error || fallback;
}

export default function KnowledgeIntelligencePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [drafts, setDrafts] = useState<FaqDraft[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, SourceDraft>>({});
  const [sourceCollectionDrafts, setSourceCollectionDrafts] = useState<Record<string, string[]>>({});
  const [assistantCollectionDrafts, setAssistantCollectionDrafts] = useState<Record<string, string[]>>({});
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionDescription, setNewCollectionDescription] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, Flash>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [healthResponse, sourceResponse, gapResponse, draftResponse, collectionResponse, assistantResponse] = await Promise.all([
        api.get("/knowledge-intelligence/health"),
        api.get("/knowledge-intelligence/sources", { params: { limit: 50 } }),
        api.get("/knowledge-intelligence/gaps", { params: { limit: 20 } }),
        api.get("/knowledge-intelligence/faq-drafts", { params: { limit: 20 } }),
        api.get("/knowledge-collections"),
        api.get("/assistants"),
      ]);
      const loadedSources: SourceItem[] = sourceResponse.data.items || [];
      const loadedCollections: Collection[] = collectionResponse.data || [];
      const loadedAssistants: Assistant[] = assistantResponse.data || [];
      setHealth(healthResponse.data);
      setSources(loadedSources);
      setCollections(loadedCollections);
      setAssistants(loadedAssistants);
      setGaps(gapResponse.data || []);
      setDrafts(draftResponse.data || []);
      setSourceDrafts(Object.fromEntries(loadedSources.map((source) => [source.id, {
        publicationStatus: source.intelligence?.publicationStatus || "PUBLISHED",
        priority: source.intelligence?.priority || "NORMAL",
        recrawlEnabled: Boolean(source.intelligence?.recrawlEnabled),
        recrawlIntervalMinutes: source.intelligence?.recrawlIntervalMinutes || 1440,
      }])));
      setSourceCollectionDrafts(Object.fromEntries(loadedSources.map((source) => [source.id, loadedCollections.filter((collection) => collection.sourceIds?.includes(source.id)).map((collection) => collection.id)])));
      setAssistantCollectionDrafts(Object.fromEntries(loadedAssistants.map((assistant) => [assistant.id, loadedCollections.filter((collection) => collection.assistantIds?.includes(assistant.id)).map((collection) => collection.id)])));
    } catch (requestError: any) {
      setError(errorText(requestError, "Knowledge Intelligence konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
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

  function originalSourceCollections(sourceId: string) {
    return collections.filter((collection) => collection.sourceIds?.includes(sourceId)).map((collection) => collection.id).sort();
  }

  function originalAssistantCollections(assistantId: string) {
    return collections.filter((collection) => collection.assistantIds?.includes(assistantId)).map((collection) => collection.id).sort();
  }

  function sameIds(a: string[] = [], b: string[] = []) {
    return [...a].sort().join("|") === [...b].sort().join("|");
  }

  function toggleId(current: string[], id: string) {
    return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
  }

  async function saveSourceSettings(source: SourceItem) {
    const draft = sourceDrafts[source.id];
    if (!draft) return;
    const key = `source-settings:${source.id}`;
    setBusyKey(key);
    try {
      await api.patch(`/knowledge-intelligence/sources/${source.id}`, {
        publicationStatus: draft.publicationStatus,
        priority: draft.priority,
        ...(source.type === "website" ? { recrawlEnabled: draft.recrawlEnabled, recrawlIntervalMinutes: draft.recrawlEnabled ? draft.recrawlIntervalMinutes : null } : {}),
      });
      setFlash((current) => ({ ...current, [key]: { type: "success", text: "Einstellungen gespeichert." } }));
      await load();
    } catch (requestError: any) {
      setFlash((current) => ({ ...current, [key]: { type: "error", text: errorText(requestError, "Einstellungen konnten nicht gespeichert werden.") } }));
    } finally { setBusyKey(null); }
  }

  async function saveSourceCollections(sourceId: string) {
    const key = `source-collections:${sourceId}`;
    setBusyKey(key);
    try {
      await api.put(`/knowledge-collections/sources/${sourceId}`, { collectionIds: sourceCollectionDrafts[sourceId] || [] });
      setFlash((current) => ({ ...current, [key]: { type: "success", text: "Collections gespeichert." } }));
      await load();
    } catch (requestError: any) {
      setFlash((current) => ({ ...current, [key]: { type: "error", text: errorText(requestError, "Collections konnten nicht gespeichert werden.") } }));
    } finally { setBusyKey(null); }
  }

  async function saveAssistantCollections(assistantId: string) {
    const key = `assistant:${assistantId}`;
    setBusyKey(key);
    try {
      await api.put(`/knowledge-collections/assistants/${assistantId}`, { collectionIds: assistantCollectionDrafts[assistantId] || [] });
      setFlash((current) => ({ ...current, [key]: { type: "success", text: "Assistant-Scope gespeichert." } }));
      await load();
    } catch (requestError: any) {
      setFlash((current) => ({ ...current, [key]: { type: "error", text: errorText(requestError, "Assistant-Scope konnte nicht gespeichert werden.") } }));
    } finally { setBusyKey(null); }
  }

  async function createCollection() {
    const name = newCollectionName.trim();
    if (!name) return;
    setBusyKey("collection:create");
    try {
      await api.post("/knowledge-collections", { name, description: newCollectionDescription.trim() || null });
      setNewCollectionName("");
      setNewCollectionDescription("");
      setFlash((current) => ({ ...current, "collection:create": { type: "success", text: "Collection erstellt." } }));
      await load();
    } catch (requestError: any) {
      setFlash((current) => ({ ...current, "collection:create": { type: "error", text: errorText(requestError, "Collection konnte nicht erstellt werden.") } }));
    } finally { setBusyKey(null); }
  }

  async function deleteCollection(collection: Collection) {
    if (!window.confirm(`Collection „${collection.name}“ löschen? Die Quellen selbst bleiben erhalten.`)) return;
    const key = `collection:${collection.id}`;
    setBusyKey(key);
    try {
      await api.delete(`/knowledge-collections/${collection.id}`);
      await load();
    } catch (requestError: any) {
      setFlash((current) => ({ ...current, [key]: { type: "error", text: errorText(requestError, "Collection konnte nicht gelöscht werden.") } }));
    } finally { setBusyKey(null); }
  }

  if (loading) return <main className="p-4 text-slate-200 sm:p-6 lg:p-8"><p role="status">Knowledge Intelligence wird geladen …</p></main>;
  if (error) return <main className="p-4 text-slate-200 sm:p-6 lg:p-8"><h1 className="text-2xl font-bold">Knowledge Intelligence</h1><p role="alert" className="mt-4 text-red-300">{error}</p><button className="mt-4 min-h-11 rounded bg-blue-600 px-4" onClick={() => { void load(); }}>Erneut versuchen</button></main>;

  return <main className="min-w-0 space-y-6 p-4 text-slate-100 sm:p-6 lg:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Knowledge Intelligence</h1><p className="mt-1 text-sm text-slate-400">Gesundheit, Collections, Assistant-Scopes, Freigaben und Recrawls.</p></div><button className="min-h-11 rounded border border-slate-700 px-4 text-sm" onClick={() => { void load(); }}>Aktualisieren</button></header>

    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Health Score" value={`${health?.score ?? 0}/100`} /><Metric label="Quellen" value={String(health?.totalSources ?? 0)} /><Metric label="Offene Gaps" value={String(health?.openGaps ?? 0)} /><Metric label="Collections" value={String(collections.length)} /></section>

    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">Health-Faktoren</h2><div className="mt-3 flex flex-wrap gap-2">{health?.factors?.length ? health.factors.map((factor) => <StatusPill key={factor.code} label={`${factor.code}: ${factor.count}`} />) : <span className="text-sm text-emerald-300">Keine negativen Health-Faktoren erkannt.</span>}</div></section>

    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div><h2 className="font-semibold">Knowledge Collections</h2><p className="mt-1 text-xs text-slate-400">Collections gruppieren Quellen. Sobald einem Assistant mindestens eine Collection zugewiesen ist, wird sein RAG auf diese Collections begrenzt.</p></div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
        <label className="text-xs text-slate-400">Name<input value={newCollectionName} maxLength={120} onChange={(event) => setNewCollectionName(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" placeholder="z. B. Billing" /></label>
        <label className="text-xs text-slate-400">Beschreibung<input value={newCollectionDescription} maxLength={1000} onChange={(event) => setNewCollectionDescription(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" placeholder="Optional" /></label>
        <button disabled={!newCollectionName.trim() || busyKey !== null} onClick={() => { void createCollection(); }} className="min-h-11 self-end rounded bg-blue-600 px-4 text-sm font-medium disabled:opacity-40">Erstellen</button>
      </div>
      <FlashMessage flash={flash["collection:create"]} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{collections.map((collection) => <article key={collection.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-medium">{collection.name}</h3><p className="mt-1 text-xs text-slate-500">{collection.description || "Keine Beschreibung"}</p></div><button className="min-h-11 rounded border border-red-900/70 px-3 text-xs text-red-300" disabled={busyKey !== null} onClick={() => { void deleteCollection(collection); }}>Löschen</button></div><div className="mt-3 flex flex-wrap gap-2"><StatusPill label={`${collection.sourceCount} Quellen`} /><StatusPill label={`${collection.assistantCount} Assistants`} /></div><FlashMessage flash={flash[`collection:${collection.id}`]} /></article>)}{!collections.length && <p className="text-sm text-slate-400">Noch keine Collections vorhanden. Ohne Collection-Zuordnung bleiben Assistants rückwärtskompatibel unrestricted.</p>}</div>
    </section>

    <section className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 p-4"><h2 className="font-semibold">Quellen, Collections & Recrawls</h2><p className="mt-1 text-xs text-slate-400">Eine Quelle kann mehreren Collections angehören. Publication-State und bestehende Sicherheitsfilter gelten zusätzlich.</p></div>
      <div className="divide-y divide-slate-800">{sources.map((source) => {
        const draft = sourceDrafts[source.id];
        if (!draft) return null;
        const collectionDraft = sourceCollectionDrafts[source.id] || [];
        const collectionChanged = !sameIds(collectionDraft, originalSourceCollections(source.id));
        const settingsKey = `source-settings:${source.id}`;
        const collectionsKey = `source-collections:${source.id}`;
        return <article key={source.id} className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><h3 className="break-words font-medium">{source.title}</h3><p className="mt-1 text-xs text-slate-500">{source.type} · {source.chunkCount} Chunks · {source.status}</p></div><div className="flex flex-wrap gap-2"><StatusPill label={`Health: ${source.intelligence?.health || source.status}`} /><StatusPill label={`${source.intelligence?.retrievalCount || 0} Retrievals`} /><StatusPill label={`${source.intelligence?.answerUsageCount || 0} Antworten`} /></div></div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SelectField label="Freigabe" value={draft.publicationStatus} options={["DRAFT", "PUBLISHED", "ARCHIVED"]} onChange={(value) => setSourceDrafts((current) => ({ ...current, [source.id]: { ...current[source.id], publicationStatus: value } }))} />
            <SelectField label="Priorität" value={draft.priority} options={["LOW", "NORMAL", "HIGH", "AUTHORITATIVE"]} onChange={(value) => setSourceDrafts((current) => ({ ...current, [source.id]: { ...current[source.id], priority: value } }))} />
            {source.type === "website" ? <><label className="flex min-h-11 items-center gap-3 rounded border border-slate-700 bg-slate-950 px-3 text-sm"><input type="checkbox" checked={draft.recrawlEnabled} onChange={(event) => setSourceDrafts((current) => ({ ...current, [source.id]: { ...current[source.id], recrawlEnabled: event.target.checked } }))} />Automatischer Recrawl</label><label className="text-xs text-slate-400">Intervall<select disabled={!draft.recrawlEnabled} value={draft.recrawlIntervalMinutes} onChange={(event) => setSourceDrafts((current) => ({ ...current, [source.id]: { ...current[source.id], recrawlIntervalMinutes: Number(event.target.value) } }))} className="mt-1 min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm disabled:opacity-50">{RECRAWL_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label></> : <div className="sm:col-span-2"><p className="text-xs text-slate-500">Kein Recrawl für diesen Quellentyp.</p></div>}
          </div>

          <div><p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Collections</p>{collections.length ? <div className="flex flex-wrap gap-2">{collections.map((collection) => <label key={collection.id} className="flex min-h-11 items-center gap-2 rounded border border-slate-700 bg-slate-950 px-3 text-sm"><input type="checkbox" checked={collectionDraft.includes(collection.id)} onChange={() => setSourceCollectionDrafts((current) => ({ ...current, [source.id]: toggleId(current[source.id] || [], collection.id) }))} />{collection.name}</label>)}</div> : <p className="text-sm text-slate-500">Erstelle zuerst eine Collection.</p>}</div>

          {source.type === "website" && <div className="grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-3"><p>Letzter Crawl: {formatDate(source.lastCrawledAt)}</p><p>Nächster Crawl: {draft.recrawlEnabled ? formatDate(source.intelligence?.nextCrawlAt) : "deaktiviert"}</p><p>Letzter Erfolg: {formatDate(source.intelligence?.lastSuccessfulCrawlAt)}</p>{source.intelligence?.lastFailureAt && <p className="sm:col-span-3 text-amber-300">Letzter Fehler: {formatDate(source.intelligence.lastFailureAt)} · {source.intelligence.lastFailureCategory || "unbekannt"}</p>}</div>}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"><button disabled={!changedSourceIds.has(source.id) || busyKey !== null} onClick={() => { void saveSourceSettings(source); }} className="min-h-11 rounded bg-blue-600 px-4 text-sm disabled:opacity-40">{busyKey === settingsKey ? "Speichert …" : "Einstellungen speichern"}</button><button disabled={!collectionChanged || busyKey !== null} onClick={() => { void saveSourceCollections(source.id); }} className="min-h-11 rounded border border-slate-700 px-4 text-sm disabled:opacity-40">{busyKey === collectionsKey ? "Speichert …" : "Collections speichern"}</button><FlashMessage flash={flash[settingsKey] || flash[collectionsKey]} /></div>
        </article>;
      })}{!sources.length && <p className="p-6 text-sm text-slate-400">Keine Wissensquellen vorhanden.</p>}</div>
    </section>

    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4"><div><h2 className="font-semibold">Assistant Knowledge Scope</h2><p className="mt-1 text-xs text-slate-400">Keine Auswahl = unrestricted innerhalb des Tenants. Sobald mindestens eine Collection ausgewählt ist, darf der Assistant nur daraus RAG-Kontext beziehen.</p></div><div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{assistants.map((assistant) => {
      const selected = assistantCollectionDrafts[assistant.id] || [];
      const changed = !sameIds(selected, originalAssistantCollections(assistant.id));
      const key = `assistant:${assistant.id}`;
      return <article key={assistant.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{assistant.name}</h3><StatusPill label={selected.length ? `${selected.length} Collection${selected.length === 1 ? "" : "s"}` : "Unrestricted"} /></div><div className="mt-3 flex flex-wrap gap-2">{collections.map((collection) => <label key={collection.id} className="flex min-h-11 items-center gap-2 rounded border border-slate-700 px-3 text-sm"><input type="checkbox" checked={selected.includes(collection.id)} onChange={() => setAssistantCollectionDrafts((current) => ({ ...current, [assistant.id]: toggleId(current[assistant.id] || [], collection.id) }))} />{collection.name}</label>)}{!collections.length && <p className="text-sm text-slate-500">Keine Collections vorhanden.</p>}</div><div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"><button disabled={!changed || busyKey !== null} onClick={() => { void saveAssistantCollections(assistant.id); }} className="min-h-11 rounded bg-blue-600 px-4 text-sm disabled:opacity-40">{busyKey === key ? "Speichert …" : "Scope speichern"}</button><FlashMessage flash={flash[key]} /></div></article>;
    })}{!assistants.length && <p className="text-sm text-slate-400">Keine Assistants vorhanden.</p>}</div></section>

    <section className="grid grid-cols-1 gap-6 xl:grid-cols-2"><div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">Knowledge Gaps</h2><div className="mt-3 space-y-3">{gaps.map((gap) => <article key={gap.id} className="rounded-lg bg-slate-800/60 p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{gap.topic}</strong><span className="text-xs text-amber-300">{gap.status} · Impact {gap.impactScore}</span></div><p className="mt-1 text-sm text-slate-300">{gap.summary}</p><p className="mt-2 text-xs text-slate-500">{gap.reason} · {gap.occurrences} Vorkommen</p></article>)}{!gaps.length && <p className="text-sm text-slate-400">Keine Knowledge Gaps vorhanden.</p>}</div></div><div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="font-semibold">FAQ Review</h2><div className="mt-3 space-y-3">{drafts.map((draft) => <article key={draft.id} className="rounded-lg bg-slate-800/60 p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{draft.question}</strong><span className="text-xs text-blue-300">{draft.reviewStatus}</span></div><p className="mt-1 line-clamp-3 text-sm text-slate-300">{draft.answer}</p>{draft.confidence !== null && <p className="mt-2 text-xs text-slate-500">Confidence: {Math.round(draft.confidence * 100)}%</p>}</article>)}{!drafts.length && <p className="text-sm text-slate-400">Keine FAQ-Entwürfe zur Prüfung.</p>}</div></div></section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }
function StatusPill({ label }: { label: string }) { return <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{label}</span>; }
function FlashMessage({ flash }: { flash?: Flash }) { return flash?.text ? <p role={flash.type === "error" ? "alert" : "status"} className={flash.type === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>{flash.text}</p> : null; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="text-xs text-slate-400">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
function formatDate(value?: string | null) { if (!value) return "–"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "–" : date.toLocaleString("de-DE"); }
