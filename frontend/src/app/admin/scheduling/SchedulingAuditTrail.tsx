"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type AuditEntry = {
  id: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  createdAt: string;
};

const actionLabels: Record<string, string> = {
  "scheduling.calendar.disconnect": "Kalender getrennt",
  "scheduling.meeting_type.create": "Meeting Type erstellt",
  "scheduling.meeting_type.update": "Meeting Type geändert",
  "scheduling.availability.create": "Verfügbarkeit erstellt",
  "scheduling.availability.update": "Verfügbarkeit geändert",
  "scheduling.availability.delete": "Verfügbarkeit gelöscht",
  "scheduling.calendar_sync.retry": "Kalender-Sync manuell wiederholt",
  "scheduling.booking.create": "Buchung erstellt",
  "scheduling.booking.reschedule": "Buchung umgebucht",
  "scheduling.booking.cancel": "Buchung storniert",
};

export function SchedulingAuditTrail() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/scheduling/audit?limit=50");
      setEntries(data);
      setAvailable(true);
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) setAvailable(false);
      else setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  if (!available) return null;

  return <section className="rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">Scheduling Audit</h2><p className="mt-1 text-sm text-muted-foreground">Nachvollziehbare Änderungen an Terminarten, Verfügbarkeiten, Buchungen und Kalender-Synchronisierung.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{loading ? "Lädt…" : "Aktualisieren"}</button>
    </div>
    <div className="mt-4 space-y-2">
      {entries.length ? entries.map((entry) => <div key={entry.id} className="rounded-lg border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium">{actionLabels[entry.action] || entry.action}</p><p className="mt-1 text-xs text-muted-foreground">{entry.resourceType}{entry.resourceId ? ` · ${entry.resourceId}` : ""}</p></div><time className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("de-DE")}</time></div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Actor: {entry.actorUserId || "system"}</span>{entry.ipAddress && <span>IP: {entry.ipAddress}</span>}{typeof entry.metadata?.role === "string" && <span>Rolle: {entry.metadata.role}</span>}</div>
      </div>) : <p className="text-sm text-muted-foreground">Noch keine Scheduling-Audit-Einträge vorhanden.</p>}
    </div>
  </section>;
}
