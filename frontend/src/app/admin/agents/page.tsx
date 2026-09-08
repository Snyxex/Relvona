"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Assistant = { id: string; name: string; modelProvider: string; modelName: string; updatedAt: string };
type Version = {
  id: string;
  version: number;
  label?: string | null;
  status: string;
  createdAt: string;
  activatedAt?: string | null;
  snapshot: { name: string; systemPrompt: string; modelProvider: string; modelName: string; temperature: number; apiKeyConfigured: boolean; activeModelProfileId?: string | null };
};

export default function AdminAgentsPage() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [assistantId, setAssistantId] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadAssistants() {
    setError("");
    try {
      const { data } = await api.get("/assistants");
      setAssistants(data);
      setAssistantId((current) => current || data[0]?.id || "");
    } catch (e: any) { setError(e.response?.data?.error || "Assistants konnten nicht geladen werden."); }
  }

  async function loadVersions(id = assistantId) {
    if (!id) { setVersions([]); return; }
    setError("");
    try { const { data } = await api.get(`/assistants/${id}/versions`); setVersions(data); }
    catch (e: any) { setError(e.response?.data?.error || "Versionen konnten nicht geladen werden."); }
  }

  useEffect(() => { void loadAssistants(); }, []);
  useEffect(() => { void loadVersions(assistantId); }, [assistantId]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!assistantId) return;
    setLoading(true); setError("");
    try {
      await api.post(`/assistants/${assistantId}/versions`, { label: label.trim() || undefined });
      setLabel("");
      await loadVersions();
    } catch (e: any) { setError(e.response?.data?.error || "Version konnte nicht veröffentlicht werden."); }
    finally { setLoading(false); }
  }

  async function activate(version: Version) {
    if (!window.confirm(`Version v${version.version} wirklich als Live-Konfiguration aktivieren?`)) return;
    setLoading(true); setError("");
    try {
      await api.post(`/assistants/${assistantId}/versions/${version.id}/activate`);
      await Promise.all([loadVersions(), loadAssistants()]);
    } catch (e: any) { setError(e.response?.data?.error || "Version konnte nicht aktiviert werden."); }
    finally { setLoading(false); }
  }

  const selected = assistants.find((assistant) => assistant.id === assistantId);

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <div><p className="text-sm text-muted-foreground">AI Agents</p><h1 className="text-2xl font-semibold">Versionen</h1><p className="mt-2 text-sm text-muted-foreground">Live-Konfigurationen einfrieren, vergleichen und kontrolliert zurückrollen.</p></div>
    {error && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}

    <section className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-end justify-between gap-4"><label className="min-w-64 text-sm"><span className="mb-1 block font-medium">Assistant</span><select value={assistantId} onChange={(e) => setAssistantId(e.target.value)} className="w-full rounded-lg border bg-background px-3 py-2">{assistants.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</select></label>{selected && <div className="text-sm text-muted-foreground"><p>Live: {selected.modelProvider} / {selected.modelName}</p><p>Geändert: {new Date(selected.updatedAt).toLocaleString("de-DE")}</p></div>}</div></section>

    {assistantId && <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Aktuellen Stand veröffentlichen</h2><p className="mt-1 text-sm text-muted-foreground">Erstellt einen unveränderlichen Snapshot der aktuellen Runtime-Konfiguration. Provider-Secrets bleiben verschlüsselt und werden nicht im UI angezeigt.</p><form onSubmit={publish} className="mt-4 flex flex-wrap gap-2"><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Optionales Label, z. B. Stable September" className="min-w-72 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><button disabled={loading} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{loading ? "Verarbeitet…" : "Version veröffentlichen"}</button></form></section>}

    <section className="rounded-xl border bg-card p-5"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">Versionshistorie</h2><span className="text-xs text-muted-foreground">neueste zuerst</span></div><div className="space-y-3">{versions.length ? versions.map((version) => <div key={version.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">v{version.version}</p>{version.label && <span className="text-sm">{version.label}</span>}<span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{version.status}</span></div><p className="mt-2 text-sm text-muted-foreground">{version.snapshot.modelProvider} / {version.snapshot.modelName} · Temperatur {version.snapshot.temperature}</p><p className="mt-1 text-xs text-muted-foreground">Prompt: {version.snapshot.systemPrompt.slice(0, 180)}{version.snapshot.systemPrompt.length > 180 ? "…" : ""}</p><p className="mt-2 text-xs text-muted-foreground">Erstellt: {new Date(version.createdAt).toLocaleString("de-DE")}{version.activatedAt ? ` · Aktiviert: ${new Date(version.activatedAt).toLocaleString("de-DE")}` : ""}</p></div><button disabled={loading || version.status === "active"} onClick={() => activate(version)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{version.status === "active" ? "Aktiv" : "Aktivieren / Rollback"}</button></div></div>) : <p className="text-sm text-muted-foreground">Noch keine veröffentlichte Version vorhanden.</p>}</div></section>
  </main>;
}
