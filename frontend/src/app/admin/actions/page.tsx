"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Execution = {
  id: string;
  toolId: string;
  status: string;
  riskLevel: string;
  input: Record<string, unknown>;
  createdAt: string;
  decisionReason?: string | null;
  error?: string | null;
};

export default function AdminActionsPage() {
  const [rows, setRows] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { const { data } = await api.get("/tools/executions"); setRows(data); }
    catch (e: any) { setError(e.response?.data?.error || "AI Actions konnten nicht geladen werden."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function decide(id: string, action: "approve" | "reject") {
    setError("");
    try { await api.post(`/tools/executions/${id}/${action}`, {}); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Aktion konnte nicht verarbeitet werden."); }
  }

  return <main className="mx-auto max-w-6xl p-4 sm:p-8">
    <div className="mb-6 flex items-center justify-between gap-4"><div><p className="text-sm text-muted-foreground">Automation</p><h1 className="text-2xl font-semibold">AI Actions</h1><p className="mt-2 text-sm text-muted-foreground">Schreibende KI-Aktionen werden hier geprüft und freigegeben.</p></div><button onClick={load} className="rounded-lg border px-3 py-2 text-sm">Aktualisieren</button></div>
    {error && <div className="mb-4 rounded-lg border p-3 text-sm text-destructive">{error}</div>}
    {loading ? <p className="text-sm text-muted-foreground">Wird geladen…</p> : <div className="space-y-3">{rows.length ? rows.map((row) => <article key={row.id} className="rounded-xl border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{row.toolId}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString("de-DE")} · Risiko: {row.riskLevel}</p></div><span className="rounded-full border px-2 py-1 text-xs">{row.status}</span></div><pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(row.input, null, 2)}</pre>{row.error && <p className="mt-3 text-sm text-destructive">{row.error}</p>}{row.status === "pending" && <div className="mt-4 flex gap-2"><button onClick={() => decide(row.id, "approve")} className="rounded-lg bg-foreground px-3 py-2 text-sm text-background">Freigeben & ausführen</button><button onClick={() => decide(row.id, "reject")} className="rounded-lg border px-3 py-2 text-sm text-destructive">Ablehnen</button></div>}</article>) : <div className="rounded-xl border p-6 text-sm text-muted-foreground">Keine AI Actions vorhanden.</div>}</div>}
  </main>;
}
