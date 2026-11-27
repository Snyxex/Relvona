"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw, Save, TestTube2 } from "lucide-react";
import {
  AdminButton,
  AdminHeader,
  AdminNotice,
  AdminPage,
  AdminPanel,
  adminControlClassName,
} from "@/components/admin/admin-ui";
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
    <label className="block space-y-1.5 text-sm text-[#536584]">
      <span className="font-medium text-[#172742]">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[#667694]">{hint}</span>}
    </label>
  );
}

const inputClass = adminControlClassName;

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
    return <AdminPage width="narrow"><AdminHeader eyebrow="Verwaltung / Kommunikation" title="Mailserver" description="SMTP für Terminbestätigungen konfigurieren." icon={Mail} /><AdminPanel><div role="status" aria-label="Mailserver-Einstellungen werden geladen" className="h-60 animate-pulse rounded-xl bg-[#f1f5fb]" /></AdminPanel></AdminPage>;
  }

  return (
    <AdminPage width="narrow">
      <AdminHeader
        eyebrow="Verwaltung / Kommunikation"
        title="Mailserver"
        description="SMTP für Terminbestätigungen konfigurieren."
        icon={Mail}
      />

      {notice && <AdminNotice tone="success">{notice}</AdminNotice>}
      {error && <AdminNotice tone="error">{error}</AdminNotice>}

      <AdminPanel title="SMTP-Konfiguration" description="Zugangsdaten und Absenderinformationen für automatische Terminbestätigungen.">
        <label className="flex items-start gap-3 rounded-xl border border-[#e5eaf3] bg-[#f8faff] p-4">
          <input type="checkbox" checked={form.enabled} onChange={(event) => change("enabled", event.target.checked)} className="mt-1 h-4 w-4" />
          <span>
            <span className="block font-medium">Terminbestätigungen per E-Mail aktivieren</span>
            <span className="mt-1 block text-sm text-[#667694]">Nach einer erfolgreich erstellten Kundenbuchung sendet Relvona automatisch eine Bestätigung. Ein Mailfehler macht die Buchung nicht rückgängig.</span>
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

        <div className="flex flex-col gap-3 border-t border-[#edf0f6] pt-5 sm:flex-row sm:justify-end">
          <AdminButton variant="secondary" disabled={testing || saving} onClick={testConnection}>
            {testing ? <RefreshCw size={16} className="animate-spin" /> : <TestTube2 size={16} />}
            Verbindung testen
          </AdminButton>
          <AdminButton disabled={saving || testing} onClick={save}>
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            Speichern
          </AdminButton>
        </div>
      </AdminPanel>
    </AdminPage>
  );
}
