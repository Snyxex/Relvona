"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  AdminButton,
  AdminHeader,
  AdminNotice,
  AdminPage,
  AdminPanel,
} from "@/components/admin/admin-ui";
import { api } from "@/lib/api";

type Policy = "required" | "recommended" | "disabled";
type Notice = { tone: "success" | "error"; text: string };

const options: Array<{ value: Policy; label: string; description: string }> = [
  {
    value: "required",
    label: "Pflicht",
    description:
      "Ohne eingerichtete 2FA ist nur noch der Zugriff auf die persönlichen Profileinstellungen möglich.",
  },
  {
    value: "recommended",
    label: "Empfohlen",
    description:
      "Nutzer werden auf 2FA hingewiesen, können die Plattform aber weiterhin verwenden.",
  },
  {
    value: "disabled",
    label: "Freiwillig",
    description: "2FA wird nicht verpflichtend eingefordert.",
  },
];

export default function PlatformSecurityPage() {
  const [policy, setPolicy] = useState<Policy>("recommended");
  const [saved, setSaved] = useState<Policy>("recommended");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get("/platform-admin/security-settings")
      .then(({ data }) => {
        if (!active) return;
        setPolicy(data.twoFactorPolicy);
        setSaved(data.twoFactorPolicy);
      })
      .catch((error) => {
        if (active) {
          setNotice({
            tone: "error",
            text:
              error.response?.data?.error ||
              "Sicherheitseinstellungen konnten nicht geladen werden.",
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
    setNotice(null);
    setSaving(true);
    try {
      const { data } = await api.put("/platform-admin/security-settings", {
        twoFactorPolicy: policy,
      });
      setPolicy(data.twoFactorPolicy);
      setSaved(data.twoFactorPolicy);
      setNotice({ tone: "success", text: "2FA-Richtlinie gespeichert." });
    } catch (error: unknown) {
      const response = error as { response?: { data?: { error?: string } } };
      setNotice({
        tone: "error",
        text:
          response.response?.data?.error ||
          "2FA-Richtlinie konnte nicht gespeichert werden.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminPage width="narrow">
      <AdminHeader
        eyebrow="Verwaltung / Sicherheit"
        title="Plattform-Sicherheit"
        description="Globale Vorgabe für Zwei-Faktor-Authentifizierung. Diese Einstellung gilt organisationsübergreifend."
        icon={ShieldCheck}
      />
      {notice && <AdminNotice tone={notice.tone}>{notice.text}</AdminNotice>}
      <AdminPanel
        title="Zwei-Faktor-Authentifizierung"
        description="Lege fest, welche Anforderungen für alle Benutzerkonten gelten."
      >
        {loading ? (
          <p role="status" className="text-sm text-[#667694]">
            Einstellungen werden geladen …
          </p>
        ) : (
          <fieldset className="space-y-3" disabled={saving}>
            <legend className="sr-only">2FA-Richtlinie</legend>
            {options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#e5eaf3] bg-[#f8faff] p-4 transition-colors hover:border-[#b3c6f5]"
              >
                <input
                  type="radio"
                  name="two-factor-policy"
                  value={option.value}
                  checked={policy === option.value}
                  onChange={() => setPolicy(option.value)}
                  className="mt-1"
                />
                <span className="space-y-1">
                  <span className="block font-semibold text-[#172742]">
                    {option.label}
                  </span>
                  <span className="block text-sm leading-relaxed text-[#667694]">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex flex-wrap justify-end gap-3 border-t border-[#edf0f6] pt-5">
          <AdminButton
            disabled={loading || saving || policy === saved}
            onClick={() => void save()}
          >
            {saving ? "Speichere …" : "Richtlinie speichern"}
          </AdminButton>
        </div>
      </AdminPanel>
    </AdminPage>
  );
}
