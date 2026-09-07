"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type KnowledgeSource = {
  id: string; title: string; type: string; chunkCount: number; status: string;
  securityStatus: string; errorMessage: string | null; createdAt: string;
  job?: { attempts: number; revision: number; errorMessage: string | null } | null;
};
type Editor = { sourceId: string; title: string; content: string; category: string; language: string };

export default function KnowledgeSources({ sources, canManage, onRefresh, notify }: {
  sources: KnowledgeSource[]; canManage: boolean; onRefresh: () => Promise<void>; notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const pending = sources.some((source) => ["queued", "processing"].includes(source.status));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { void onRefresh(); }, 5000);
    return () => clearInterval(timer);
  }, [pending, onRefresh]);

  async function action(source: KnowledgeSource, operation: "reprocess" | "delete" | "edit") {
    if (operation === "delete" && !window.confirm(`„${source.title}“ und alle zugehörigen Chunks löschen?`)) return;
    setBusy(source.id);
    try {
      if (operation === "edit") {
        const response = await api.get(`/knowledge/sources/${source.id}/content`);
        setEditor({ sourceId: source.id, title: response.data.title, content: response.data.content, category: response.data.category || "", language: response.data.language || "und" });
      } else {
        if (operation === "delete") await api.delete(`/knowledge/sources/${source.id}`);
        else await api.post(`/knowledge/sources/${source.id}/reprocess`);
        notify(operation === "delete" ? "Quelle gelöscht." : "Neuverarbeitung vorgemerkt.");
        await onRefresh();
      }
    } catch { notify("Aktion fehlgeschlagen. Bei alten Dokumenten kann ein erneuter Upload erforderlich sein."); }
    finally { setBusy(null); }
  }

  return <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4"><h3 className="text-sm font-semibold">Wissensquellen</h3><button type="button" className="text-xs text-blue-300" onClick={() => { void onRefresh(); }}>Aktualisieren</button></div>
    {editor && <form className="space-y-3 border-b border-slate-800 p-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(editor.sourceId);
      try { await api.put(`/knowledge/sources/${editor.sourceId}/content`, editor); setEditor(null); notify("Änderung gespeichert und Neuverarbeitung vorgemerkt."); await onRefresh(); }
      catch { notify("Änderung konnte nicht gespeichert werden."); }
      finally { setBusy(null); }
    }}>
      <label className="block text-xs">Titel / FAQ-Frage<input className="mt-1 block w-full rounded bg-slate-800 p-2" required maxLength={300} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
      <label className="block text-xs">Inhalt / FAQ-Antwort<textarea className="mt-1 block w-full rounded bg-slate-800 p-2" required rows={8} maxLength={500000} value={editor.content} onChange={(event) => setEditor({ ...editor, content: event.target.value })} /></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="min-w-0 text-xs">Kategorie<input className="mt-1 block w-full rounded bg-slate-800 p-2" maxLength={120} value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value })} /></label><label className="min-w-0 text-xs">Sprache<input className="mt-1 block w-full rounded bg-slate-800 p-2" required pattern="[a-z]{2,3}(-[A-Za-z]{2,8})?" value={editor.language} onChange={(event) => setEditor({ ...editor, language: event.target.value })} /></label></div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><button type="submit" disabled={Boolean(busy)} className="rounded bg-blue-600 px-3 py-2 text-xs disabled:opacity-50">Speichern und neu verarbeiten</button><button type="button" className="rounded px-3 py-2 text-xs" onClick={() => setEditor(null)}>Abbrechen</button></div>
    </form>}
    <div className="overflow-x-auto"><table className="w-full text-left text-xs text-slate-300">
      <thead className="bg-slate-800/80 text-slate-400"><tr><th className="p-3">Titel</th><th className="p-3">Typ</th><th className="p-3">Chunks</th><th className="p-3">Verarbeitung</th><th className="p-3">Aktionen</th></tr></thead>
      <tbody className="divide-y divide-slate-800/60">{sources.map((source) => <tr key={source.id}>
        <td className="p-3 font-medium">{source.title}</td><td className="p-3">{source.type}</td><td className="p-3">{source.chunkCount}</td>
        <td className="p-3"><span className={source.status === "failed" ? "text-red-300" : source.status === "completed" ? "text-emerald-300" : "text-amber-300"}>{source.status}</span>{source.job && <p className="mt-1 text-slate-500">Version {source.job.revision} · Versuch {source.job.attempts}/3</p>}{source.securityStatus !== "SAFE" && <p className="text-amber-300">Sicherheitsprüfung: {source.securityStatus} – nicht für KI-Antworten freigegeben</p>}{source.errorMessage && <p className="mt-1 max-w-sm text-red-300">{source.errorMessage}</p>}</td>
        <td className="p-3">{canManage && <div className="flex flex-wrap gap-3">
          <button type="button" disabled={Boolean(busy) || ["queued", "processing"].includes(source.status)} className="text-blue-300 disabled:opacity-40" onClick={() => { void action(source, "reprocess"); }}>{source.type === "website" ? "Erneut crawlen" : "Neu verarbeiten"}</button>
          {["document", "faq"].includes(source.type) && <button type="button" disabled={Boolean(busy)} className="text-blue-300 disabled:opacity-40" onClick={() => { void action(source, "edit"); }}>Bearbeiten</button>}
          <button type="button" disabled={Boolean(busy)} className="text-red-300 disabled:opacity-40" onClick={() => { void action(source, "delete"); }}>Löschen</button>
        </div>}</td>
      </tr>)}{!sources.length && <tr><td colSpan={5} className="p-6 text-slate-400">Noch keine Wissensquellen vorhanden. Füge einen Text, eine FAQ, eine PDF oder eine Website hinzu.</td></tr>}</tbody>
    </table></div>
  </section>;
}
