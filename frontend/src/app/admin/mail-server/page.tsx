"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Mail, RefreshCw, Save, TestTube2 } from "lucide-react";
import { api } from "@/lib/api";

type MailSettings = {
  enabled: boolean;
  host: string | null;
  port: number;
  security: "none" | "starttls" | "tls";
  username: string | null;
  fromEmail: string | null;
  fromName: string;
  replyTo: string | null;
  passwordConfigured: boolean;
};

const defaults: MailSettings = {
  enabled: false,
  host: "",
  port: 587,
  security: "starttls",
  username: "",
  fromEmail: "",
  fromName: "Relvona",
  replyTo: "",
  passwordConfigured: false,
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

export default function MailServerPage() {
  const [form, setForm] = useState<MailSettings>(defaults);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const change = <K extends keyof MailSettings>(key: K, value: MailSettings[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/mail-server");
      setForm({ ...defaults, ...data.settings });
      setPassword("");
    } catch (e: any) {
      setError(e.response?.data?.error || "Mailserver-Einstellungen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const payload = () => ({
    enabled: form.enabled,
    host: form.host || null,
    port: Number(form.port),
    security: form.security,
    username: form.username || null,
    fromEmail: form.fromEmail || null,
    fromName: form.fromName || "Relvona",
    replyTo: form.replyTo || null,
    ...(password ? { password } : {}),
  });

  async function save() {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const { data } = await api.put("/admin/mail-server", payload());
      setForm({ ...defaults, ...data.settings });
      setPassword("");
      setNotice("Mailserver-Einstellungen wurden gespeichert.");
    } catch (e: any) {
      setError(e.response?.data?.error || "Mailserver-Einstellungen konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setNotice("");
    setError("");
    try {
      await api.post("/admin/mail-server/test", payload());
      setNotice("Verbindung und SMTP-Anmeldung sind erfolgreich.");
    } catch (e: any) {
      setError(e.response?.data?.error || "Mailserver-Test fehlgeschlagen.");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <main className="mx-auto max-w-4xl p-6 sm:p-10"><div className="h-96 animate-pulse rounded-xl bg-slate-800" /></main>;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 text-slate-100 sm:p-10">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-blue-500/10 p-2 text-blue-300"><Mail size={22} /></span>
          <div>
            <h1 className="text-2xl font-bold">Mailserver</h1>
            <p className="text-sm text-slate-400">SMTP für Terminbestätigungen konfigurieren.</p>
          </div>
        </div>
      </header>

      {notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-300"><CheckCircle2 size={17} />{notice}</div>}
      {error && <div role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}

      <section className="space-y-6 rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-sm sm:p-6">
        <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
          <input type="checkbox" checked={form.enabled} onChange={(event) => change("enabled", event.target.checked)} className="mt-1 h-4 w-4" />
          <span>
            <span className="block font-medium">Terminbestätigungen per E-Mail aktivieren</span>
            <span className="mt-1 block text-sm text-slate-400">Nach einer erfolgreich erstellten Kundenbuchung sendet Relvona automatisch eine Bestätigung. Ein Mailfehler macht die Buchung nicht rückgängig.</span>
          </span>
        </label>

        <div className="grid gap-5 sm:grid-cols-[1fr_140px]">
          <Field label="SMTP-Host" hint="Hostname oder IP-Adresse, ohne smtp:// oder https://">
            <input className={inputClass} value={form.host || ""} onChange={(event) => change("host", event.target.value)} placeholder="smtp.example.com" autoComplete="off" />
          </Field>
          <Field label="Port">
            <input className={inputClass} type="number" min={1} max={65535} value={form.port} onChange={(event) => change("port", Number(event.target.value))} />
          </Field>
        </div>

        <Field label="Verbindungssicherheit" hint={form.security === "tls" ? "Direktes TLS, typischerweise Port 465." : form.security === "starttls" ? "STARTTLS aktualisiert die Verbindung vor der Anmeldung, typischerweise Port 587." : "Unverschlüsselt. Nur in einem vertrauenswürdigen internen Netzwerk verwenden."}>
          <select className={inputClass} value={form.security} onChange={(event) => change("security", event.target.value as MailSettings["security"])}>
            <option value="starttls">STARTTLS (empfohlen)</option>
            <option value="tls">TLS</option>
            <option value="none">Keine Verschlüsselung</option>
          </select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="SMTP-Benutzername">
            <input className={inputClass} value={form.username || ""} onChange={(event) => change("username", event.target.value)} autoComplete="username" placeholder="mailer@example.com" />
          </Field>
          <Field label="SMTP-Passwort" hint={form.passwordConfigured && !password ? "Ein Passwort ist bereits verschlüsselt gespeichert. Leer lassen, um es beizubehalten." : "Das Passwort wird verschlüsselt gespeichert und nach dem Speichern nicht erneut angezeigt."}>
            <input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={form.passwordConfigured ? "•••••••• (konfiguriert)" : "Passwort"} />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Absendername">
            <input className={inputClass} value={form.fromName || ""} onChange={(event) => change("fromName", event.target.value)} placeholder="Relvona Support" />
          </Field>
          <Field label="Absender-E-Mail">
            <input className={inputClass} type="email" value={form.fromEmail || ""} onChange={(event) => change("fromEmail", event.target.value)} placeholder="support@example.com" />
          </Field>
        </div>

        <Field label="Reply-To (optional)" hint="Antworten des Kunden werden an diese Adresse gesendet. Leer = Absenderadresse.">
          <input className={inputClass} type="email" value={form.replyTo || ""} onChange={(event) => change("replyTo", event.target.value)} placeholder="support@example.com" />
        </Field>

        <div className="flex flex-col gap-3 border-t border-slate-800 pt-5 sm:flex-row sm:justify-end">
          <button type="button" disabled={testing || saving} onClick={testConnection} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
            {testing ? <RefreshCw size={16} className="animate-spin" /> : <TestTube2 size={16} />}
            Verbindung testen
          </button>
          <button type="button" disabled={saving || testing} onClick={save} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            Speichern
          </button>
        </div>
      </section>
    </main>
  );
}
