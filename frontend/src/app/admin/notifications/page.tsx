"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Settings = {
  bookingReminderEnabled: boolean;
  bookingReminderMinutes: number;
  ticketIdleEnabled: boolean;
  ticketIdleMinutes: number;
};

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    api.get("/notifications/settings").then(({ data }) => setSettings(data)).catch((error) => setStatus(error.response?.data?.error || "Einstellungen konnten nicht geladen werden."));
  }, []);

  async function save() {
    if (!settings) return;
    setStatus("");
    try {
      const { data } = await api.put("/notifications/settings", settings);
      setSettings(data);
      setStatus("Gespeichert.");
    } catch (error: any) {
      setStatus(error.response?.data?.error || "Speichern fehlgeschlagen.");
    }
  }

  if (!settings) return <main className="p-6 text-slate-100"><h1 className="text-xl font-semibold">Benachrichtigungen</h1><p className="mt-4 text-sm text-slate-400">{status || "Lade Einstellungen ..."}</p></main>;

  return (
    <main className="mx-auto max-w-3xl p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">Benachrichtigungen</h1>
      <p className="mt-2 text-sm text-slate-400">Konfiguriere interne Erinnerungen für bevorstehende Termine und unbeantwortete Tickets.</p>

      <div className="mt-6 space-y-5 rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <section className="space-y-3">
          <label className="flex items-center gap-3"><input type="checkbox" checked={settings.bookingReminderEnabled} onChange={(e) => setSettings({ ...settings, bookingReminderEnabled: e.target.checked })} /><span className="font-medium">Termin-Erinnerungen aktivieren</span></label>
          <label className="block text-sm text-slate-400">Wie viele Minuten vor einem Termin soll gewarnt werden?
            <input type="number" min={5} max={10080} value={settings.bookingReminderMinutes} onChange={(e) => setSettings({ ...settings, bookingReminderMinutes: Number(e.target.value) })} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100" />
          </label>
        </section>

        <section className="space-y-3 border-t border-slate-800 pt-5">
          <label className="flex items-center gap-3"><input type="checkbox" checked={settings.ticketIdleEnabled} onChange={(e) => setSettings({ ...settings, ticketIdleEnabled: e.target.checked })} /><span className="font-medium">Ticket-Inaktivitätswarnungen aktivieren</span></label>
          <label className="block text-sm text-slate-400">Nach wie vielen Minuten ohne öffentliche Mitarbeiterantwort soll gewarnt werden?
            <input type="number" min={5} max={10080} value={settings.ticketIdleMinutes} onChange={(e) => setSettings({ ...settings, ticketIdleMinutes: Number(e.target.value) })} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100" />
          </label>
          <p className="text-xs text-slate-500">Tickets mit Status „pending“, „resolved“ oder „closed“ werden nicht als inaktiv gewarnt.</p>
        </section>

        <div className="flex items-center gap-3 border-t border-slate-800 pt-5">
          <button type="button" onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Speichern</button>
          {status && <span className="text-sm text-slate-400">{status}</span>}
        </div>
      </div>
    </main>
  );
}
