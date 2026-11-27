"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import {
  AdminButton,
  AdminHeader,
  AdminNotice,
  AdminPage,
  AdminPanel,
  adminControlClassName,
} from "@/components/admin/admin-ui";
import { api } from "@/lib/api";

type Settings = {
  bookingReminderEnabled: boolean;
  bookingReminderMinutes: number;
  ticketIdleEnabled: boolean;
  ticketIdleMinutes: number;
};
type Notice = { tone: "success" | "error"; text: string };

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get("/notifications/settings")
      .then(({ data }) => {
        if (active) setSettings(data);
      })
      .catch((error) => {
        if (active) {
          setNotice({
            tone: "error",
            text:
              error.response?.data?.error ||
              "Einstellungen konnten nicht geladen werden.",
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!settings) return;
    setNotice(null);
    setSaving(true);
    try {
      const { data } = await api.put("/notifications/settings", settings);
      setSettings(data);
      setNotice({ tone: "success", text: "Einstellungen gespeichert." });
    } catch (error: unknown) {
      const response = error as { response?: { data?: { error?: string } } };
      setNotice({
        tone: "error",
        text: response.response?.data?.error || "Speichern fehlgeschlagen.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminPage width="narrow">
      <AdminHeader
        eyebrow="Arbeitsbereich / Benachrichtigungen"
        title="Benachrichtigungen"
        description="Konfiguriere interne Erinnerungen für bevorstehende Termine und unbeantwortete Tickets."
        icon={BellRing}
      />
      {notice && <AdminNotice tone={notice.tone}>{notice.text}</AdminNotice>}
      {loading ? (
        <AdminPanel>
          <p role="status" className="text-sm text-[#667694]">
            Einstellungen werden geladen …
          </p>
        </AdminPanel>
      ) : (
        settings && (
          <AdminPanel title="Erinnerungsregeln">
            <div className="space-y-6">
              <section className="space-y-3">
                <label className="flex items-center gap-3 font-semibold text-[#172742]">
                  <input
                    type="checkbox"
                    checked={settings.bookingReminderEnabled}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        bookingReminderEnabled: event.target.checked,
                      })
                    }
                  />
                  Termin-Erinnerungen aktivieren
                </label>
                <label className="block space-y-2 text-sm text-[#667694]">
                  <span>
                    Wie viele Minuten vor einem Termin soll gewarnt werden?
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={10080}
                    value={settings.bookingReminderMinutes}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        bookingReminderMinutes: Number(event.target.value),
                      })
                    }
                    className={adminControlClassName}
                  />
                </label>
              </section>

              <section className="space-y-3 border-t border-[#edf0f6] pt-5">
                <label className="flex items-center gap-3 font-semibold text-[#172742]">
                  <input
                    type="checkbox"
                    checked={settings.ticketIdleEnabled}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        ticketIdleEnabled: event.target.checked,
                      })
                    }
                  />
                  Ticket-Inaktivitätswarnungen aktivieren
                </label>
                <label className="block space-y-2 text-sm text-[#667694]">
                  <span>
                    Nach wie vielen Minuten ohne öffentliche Mitarbeiterantwort
                    soll gewarnt werden?
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={10080}
                    value={settings.ticketIdleMinutes}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        ticketIdleMinutes: Number(event.target.value),
                      })
                    }
                    className={adminControlClassName}
                  />
                </label>
                <p className="text-xs text-[#667694]">
                  Tickets mit Status „pending“, „resolved“ oder „closed“ werden
                  nicht als inaktiv gewarnt.
                </p>
              </section>
              <div className="flex justify-end border-t border-[#edf0f6] pt-5">
                <AdminButton disabled={saving} onClick={() => void save()}>
                  {saving ? "Speichere …" : "Einstellungen speichern"}
                </AdminButton>
              </div>
            </div>
          </AdminPanel>
        )
      )}
    </AdminPage>
  );
}
