"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

type Policy = "required" | "recommended" | "disabled";
const options: Array<{ value: Policy; label: string; description: string }> = [
  { value: "required", label: "Pflicht", description: "Ohne eingerichtete 2FA ist nur noch der Zugriff auf die persönlichen Profileinstellungen möglich." },
  { value: "recommended", label: "Empfohlen", description: "Nutzer werden auf 2FA hingewiesen, können die Plattform aber weiterhin verwenden." },
  { value: "disabled", label: "Nein", description: "2FA bleibt freiwillig und es wird kein Hinweis erzwungen." },
];

export default function PlatformSecurityPage() {
  const [policy, setPolicy] = useState<Policy>("recommended");
  const [saved, setSaved] = useState<Policy>("recommended");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get("/platform-admin/security-settings")
      .then(({ data }) => { setPolicy(data.twoFactorPolicy); setSaved(data.twoFactorPolicy); })
      .catch((error) => setMessage(error.response?.data?.error || "Sicherheitseinstellungen konnten nicht geladen werden."))
      .finally(() => setLoading(false));
  }, []);
  const save = async () => {
    setMessage("");
    try {
      const { data } = await api.put("/platform-admin/security-settings", { twoFactorPolicy: policy });
      setPolicy(data.twoFactorPolicy); setSaved(data.twoFactorPolicy); setMessage("2FA-Richtlinie gespeichert.");
    } catch (error: any) { setMessage(error.response?.data?.error || "2FA-Richtlinie konnte nicht gespeichert werden."); }
  };
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100 sm:p-10"><div className="mx-auto max-w-3xl">
    <div className="flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-blue-400" /><div><h1 className="text-2xl font-bold">Plattform-Sicherheit</h1><p className="text-sm text-slate-400">Globale Vorgabe für Zwei-Faktor-Authentifizierung.</p></div></div>
    <section className="mt-8 space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6"><h2 className="font-semibold">2FA für Benutzer</h2>
      {loading ? <p className="text-sm text-slate-400">Einstellungen werden geladen …</p> : options.map((option) => <label key={option.value} className="flex cursor-pointer gap-3 rounded-lg border border-slate-700 p-4"><input type="radio" name="two-factor-policy" value={option.value} checked={policy === option.value} onChange={() => setPolicy(option.value)} /><span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-sm text-slate-400">{option.description}</span></span></label>)}
      {message && <p role="status" className="text-sm text-blue-300">{message}</p>}
      <button type="button" disabled={loading || policy === saved} onClick={() => void save()} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Speichern</button>
    </section>
  </div></main>;
}
