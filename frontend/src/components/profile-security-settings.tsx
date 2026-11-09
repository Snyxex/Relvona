"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export default function ProfileSecuritySettings({
  user,
  onUserChange,
}: {
  user: any;
  onUserChange: (user: any) => void;
}) {
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
    event.preventDefault();
    setMessage("");
    if (newPassword.length < 12)
      return setMessage(
        "Das neue Passwort muss mindestens 12 Zeichen enthalten.",
      );
    if (newPassword !== confirmation)
      return setMessage("Die neuen Passwörter stimmen nicht überein.");
    setBusy(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error)
        throw new Error(
          result.error.message || "Passwortänderung fehlgeschlagen.",
        );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setMessage("Passwort wurde geändert. Andere Sitzungen wurden beendet.");
    } catch (error: any) {
      setMessage(error.message || "Passwort konnte nicht geändert werden.");
    } finally {
      setBusy(false);
    }
  };

  const startTwoFactor = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.twoFactor.enable({
        password: twoFactorPassword,
        issuer: "Relvona",
        method: "totp",
      });
      if (result.error)
        throw new Error(
          result.error.message || "2FA konnte nicht vorbereitet werden.",
        );
      if (result.data?.method !== "totp")
        throw new Error("Authenticator-Methode wurde nicht aktiviert.");
      const uri = result.data.totpURI;
      if (!uri)
        throw new Error(
          "Authenticator-Schlüssel konnte nicht erstellt werden.",
        );
      setTotpUri(uri);
      setBackupCodes(result.data.backupCodes);
      setQrCode(await QRCode.toDataURL(uri, { width: 220, margin: 2 }));
      setMessage(
        "Scanne den QR-Code und bestätige anschließend den sechsstelligen Code.",
      );
    } catch (error: any) {
      setMessage(error.message || "2FA konnte nicht vorbereitet werden.");
    } finally {
      setBusy(false);
    }
  };

  const verifyTwoFactor = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: totpCode,
        trustDevice: true,
      });
      if (result.error)
        throw new Error(
          result.error.message || "Der Authenticator-Code ist ungültig.",
        );
      await refreshUser();
      setTotpCode("");
      setTotpUri("");
      setQrCode("");
      setTwoFactorPassword("");
      setMessage(
        "Zwei-Faktor-Authentifizierung ist jetzt aktiv. Bewahre die Wiederherstellungscodes sicher auf.",
      );
    } catch (error: any) {
      setMessage(error.message || "2FA konnte nicht bestätigt werden.");
    } finally {
      setBusy(false);
    }
  };

  const disableTwoFactor = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.twoFactor.disable({
        password: twoFactorPassword,
      });
      if (result.error)
        throw new Error(
          result.error.message || "2FA konnte nicht deaktiviert werden.",
        );
      await refreshUser();
      setTwoFactorPassword("");
      setBackupCodes([]);
      setMessage("Zwei-Faktor-Authentifizierung wurde deaktiviert.");
    } catch (error: any) {
      setMessage(error.message || "2FA konnte nicht deaktiviert werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rv-security-grid">
      {message && (
        <p
          role="status"
          className="rv-notice rv-notice--info rv-security-notice"
        >
          {message}
        </p>
      )}
      {user.twoFactorPolicy !== "disabled" && !user.twoFactorEnabled && (
        <div
          className={`rv-notice rv-security-notice ${user.twoFactorPolicy === "required" ? "rv-notice--danger" : "rv-notice--warning"}`}
        >
          <strong>
            {user.twoFactorPolicy === "required"
              ? "2FA ist verpflichtend."
              : "2FA wird empfohlen."}
          </strong>{" "}
          Richte eine Authenticator-App ein, um dein Konto zu schützen.
        </div>
      )}
      <form
        onSubmit={changePassword}
        className="rv-section-panel rv-security-card"
      >
        <div className="rv-section-panel-heading">
          <h2>Passwort ändern</h2>
          <p id="profile-password-hint">
            Mindestens 12 Zeichen. Andere Sitzungen werden nach der Änderung
            beendet.
          </p>
        </div>
        <label className="rv-form-field" htmlFor="profile-current-password">
          Aktuelles Passwort
          <input
            id="profile-current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            className="rv-form-input"
          />
        </label>
        <label className="rv-form-field" htmlFor="profile-new-password">
          Neues Passwort
          <input
            id="profile-new-password"
            type="password"
            autoComplete="new-password"
            aria-describedby="profile-password-hint"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            minLength={12}
            className="rv-form-input"
          />
        </label>
        <label
          className="rv-form-field"
          htmlFor="profile-password-confirmation"
        >
          Neues Passwort wiederholen
          <input
            id="profile-password-confirmation"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            minLength={12}
            className="rv-form-input"
          />
        </label>
        <div className="rv-form-actions">
          <button type="submit" disabled={busy} className="rv-section-button">
            Passwort ändern
          </button>
        </div>
      </form>
      <section
        className="rv-section-panel rv-security-card"
        aria-labelledby="profile-two-factor-title"
      >
        <div className="rv-section-panel-heading">
          <h2 id="profile-two-factor-title">Zwei-Faktor-Authentifizierung</h2>
          <p>
            Eine zusätzliche Bestätigung bei der Anmeldung schützt dein Konto.
          </p>
        </div>
        <span
          className={`rv-profile-security-badge ${user.twoFactorEnabled ? "rv-profile-security-badge--active" : ""}`}
        >
          {user.twoFactorEnabled ? "Aktiv" : "Nicht eingerichtet"}
        </span>
        {!user.twoFactorEnabled && !totpUri && (
          <>
            <label
              className="rv-form-field"
              htmlFor="profile-two-factor-password"
            >
              Aktuelles Passwort
              <input
                id="profile-two-factor-password"
                type="password"
                autoComplete="current-password"
                value={twoFactorPassword}
                onChange={(event) => setTwoFactorPassword(event.target.value)}
                className="rv-form-input"
              />
            </label>
            <div className="rv-form-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void startTwoFactor()}
                className="rv-section-button"
              >
                Authenticator-App einrichten
              </button>
            </div>
          </>
        )}
        {totpUri && (
          <div className="rv-profile-two-factor-setup">
            <div className="rv-profile-qr">
              {qrCode && (
                <img
                  src={qrCode}
                  alt="QR-Code für die Authenticator-App"
                  width={220}
                  height={220}
                />
              )}
            </div>
            <details className="rv-form-hint">
              <summary>Manuellen Einrichtungsschlüssel anzeigen</summary>
              <code className="rv-profile-secret">{totpUri}</code>
            </details>
            <label className="rv-form-field" htmlFor="profile-totp-code">
              Sechsstelliger Authenticator-Code
              <input
                id="profile-totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(event) =>
                  setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="rv-form-input"
              />
            </label>
            <button
              type="button"
              disabled={busy || totpCode.length !== 6}
              onClick={() => void verifyTwoFactor()}
              className="rv-section-button"
            >
              2FA bestätigen
            </button>
          </div>
        )}
        {user.twoFactorEnabled && (
          <>
            <label
              className="rv-form-field"
              htmlFor="profile-two-factor-password"
            >
              Aktuelles Passwort
              <input
                id="profile-two-factor-password"
                type="password"
                autoComplete="current-password"
                value={twoFactorPassword}
                onChange={(event) => setTwoFactorPassword(event.target.value)}
                className="rv-form-input"
              />
            </label>
            <div className="rv-form-actions">
              <button
                type="button"
                disabled={busy || user.twoFactorPolicy === "required"}
                onClick={() => void disableTwoFactor()}
                className="rv-section-button rv-section-button-danger"
              >
                2FA deaktivieren
              </button>
            </div>
            {user.twoFactorPolicy === "required" && (
              <p className="rv-form-hint">
                Die Plattformrichtlinie verhindert das Deaktivieren.
              </p>
            )}
          </>
        )}
        {backupCodes.length > 0 && (
          <div className="rv-notice rv-notice--warning">
            <h3>Wiederherstellungscodes – nur jetzt speichern</h3>
            <div className="rv-profile-backup-codes">
              {backupCodes.map((code) => (
                <code key={code}>{code}</code>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
