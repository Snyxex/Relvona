"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export default function ProfileSecuritySettings({ user, onUserChange }: { user: any; onUserChange: (user: any) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshUser = async () => {
    const { data } = await api.get("/auth/me");
    onUserChange(data.user);
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage("");
    if (newPassword.length < 12) return setMessage("Das neue Passwort muss mindestens 12 Zeichen enthalten.");
    if (newPassword !== confirmation) return setMessage("Die neuen Passwörter stimmen nicht überein.");
    setBusy(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) throw new Error(result.error.message || "Passwortänderung fehlgeschlagen.");
      setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setMessage("Passwort wurde geändert. Andere Sitzungen wurden beendet.");
    } catch (error: any) { setMessage(error.message || "Passwort konnte nicht geändert werden."); }
    finally { setBusy(false); }
  };

  const startTwoFactor = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await authClient.twoFactor.enable({ password: twoFactorPassword, issuer: "Relvona", method: "totp" });
      if (result.error) throw new Error(result.error.message || "2FA konnte nicht vorbereitet werden.");
      if (result.data?.method !== "totp") throw new Error("Authenticator-Methode wurde nicht aktiviert.");
      const uri = result.data.totpURI;
      if (!uri) throw new Error("Authenticator-Schlüssel konnte nicht erstellt werden.");
      setTotpUri(uri); setBackupCodes(result.data.backupCodes); setQrCode(await QRCode.toDataURL(uri, { width: 220, margin: 2 }));
      setMessage("Scanne den QR-Code und bestätige anschließend den sechsstelligen Code.");
    } catch (error: any) { setMessage(error.message || "2FA konnte nicht vorbereitet werden."); }
    finally { setBusy(false); }
  };

  const verifyTwoFactor = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: totpCode, trustDevice: true });
      if (result.error) throw new Error(result.error.message || "Der Authenticator-Code ist ungültig.");
      await refreshUser(); setTotpCode(""); setTotpUri(""); setQrCode(""); setTwoFactorPassword(""); setMessage("Zwei-Faktor-Authentifizierung ist jetzt aktiv. Bewahre die Wiederherstellungscodes sicher auf.");
    } catch (error: any) { setMessage(error.message || "2FA konnte nicht bestätigt werden."); }
    finally { setBusy(false); }
  };

  const disableTwoFactor = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await authClient.twoFactor.disable({ password: twoFactorPassword });
      if (result.error) throw new Error(result.error.message || "2FA konnte nicht deaktiviert werden.");
      await refreshUser(); setTwoFactorPassword(""); setBackupCodes([]); setMessage("Zwei-Faktor-Authentifizierung wurde deaktiviert.");
    } catch (error: any) { setMessage(error.message || "2FA konnte nicht deaktiviert werden."); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    {user.twoFactorPolicy !== "disabled" && !user.twoFactorEnabled && <div className={`rounded-lg border p-4 text-sm ${user.twoFactorPolicy === "required" ? "border-red-700 bg-red-950/40 text-red-200" : "border-amber-700 bg-amber-950/30 text-amber-200"}`}><strong>{user.twoFactorPolicy === "required" ? "2FA ist verpflichtend." : "2FA wird empfohlen."}</strong> Richte eine Authenticator-App ein, um dein Konto zu schützen.</div>}
    <form onSubmit={changePassword} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div><h2 className="font-semibold">Passwort ändern</h2><p className="text-xs text-slate-400">Mindestens 12 Zeichen. Andere Sitzungen werden nach der Änderung beendet.</p></div>
      <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Aktuelles Passwort" required className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2" />
      <div className="grid gap-3 sm:grid-cols-2"><input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Neues Passwort" required minLength={12} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2" /><input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="Neues Passwort wiederholen" required minLength={12} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2" /></div>
      <button disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Passwort ändern</button>
    </form>
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div><h2 className="font-semibold">Zwei-Faktor-Authentifizierung</h2><p className="text-xs text-slate-400">Status: {user.twoFactorEnabled ? "Aktiv" : "Nicht eingerichtet"}</p></div>
      {!user.twoFactorEnabled && !totpUri && <><input type="password" autoComplete="current-password" value={twoFactorPassword} onChange={(e) => setTwoFactorPassword(e.target.value)} placeholder="Aktuelles Passwort" className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2" /><button type="button" disabled={busy} onClick={() => void startTwoFactor()} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Authenticator-App einrichten</button></>}
      {totpUri && <div className="space-y-4"><div className="w-fit rounded-lg bg-white p-3">{qrCode && <img src={qrCode} alt="QR-Code für die Authenticator-App" className="h-[220px] w-[220px]" />}</div><details className="text-xs text-slate-400"><summary>Manuellen Einrichtungsschlüssel anzeigen</summary><code className="mt-2 block break-all">{totpUri}</code></details><div className="flex flex-wrap gap-2"><input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-stelliger Code" className="rounded border border-slate-700 bg-slate-800 px-3 py-2" /><button type="button" disabled={busy || totpCode.length !== 6} onClick={() => void verifyTwoFactor()} className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">2FA bestätigen</button></div></div>}
      {user.twoFactorEnabled && <><input type="password" autoComplete="current-password" value={twoFactorPassword} onChange={(e) => setTwoFactorPassword(e.target.value)} placeholder="Aktuelles Passwort" className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2" /><button type="button" disabled={busy || user.twoFactorPolicy === "required"} onClick={() => void disableTwoFactor()} className="rounded border border-red-700 px-4 py-2 text-sm text-red-300 disabled:opacity-50">2FA deaktivieren</button>{user.twoFactorPolicy === "required" && <p className="text-xs text-slate-400">Die Plattformrichtlinie verhindert das Deaktivieren.</p>}</>}
      {backupCodes.length > 0 && <div className="rounded-lg border border-amber-700 bg-amber-950/30 p-4"><h3 className="text-sm font-semibold text-amber-200">Wiederherstellungscodes – nur jetzt speichern</h3><div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">{backupCodes.map((code) => <code key={code}>{code}</code>)}</div></div>}
      {message && <p role="status" className="text-sm text-blue-300">{message}</p>}
    </section>
  </div>;
}
