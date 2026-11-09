"use client";

import type { FormEventHandler } from "react";
import {
  Check,
  Palette,
  Save,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";
import ProfileSecuritySettings from "@/components/profile-security-settings";
import { WorkspaceHeader, WorkspacePanel } from "./workspace-primitives";
import {
  DEFAULT_USER_THEME,
  LIGHT_USER_THEME,
  type UserThemePreferences,
} from "@/lib/user-theme";

type ProfileUser = {
  name: string;
  email: string;
  twoFactorEnabled?: boolean;
  twoFactorPolicy?: string;
};

type Props = {
  user: ProfileUser;
  name: string;
  avatarUrl: string | null;
  language: string;
  theme: UserThemePreferences;
  onNameChange: (name: string) => void;
  onAvatarChange: (url: string | null) => void;
  onImageUpload: (file: File | undefined) => void;
  onLanguageChange: (language: string) => void;
  onThemeChange: (theme: UserThemePreferences) => void;
  onSave: FormEventHandler<HTMLFormElement>;
  onUserChange: (user: ProfileUser) => void;
};

export default function ProfileWorkspace({
  user,
  name,
  avatarUrl,
  language,
  theme,
  onNameChange,
  onAvatarChange,
  onImageUpload,
  onLanguageChange,
  onThemeChange,
  onSave,
  onUserChange,
}: Props) {
  return (
    <div className="rv-section-page rv-profile-workspace">
      <WorkspaceHeader
        eyebrow="DEIN KONTO"
        title="Profil-Einstellungen"
        description="Deine persönlichen Angaben, dein Erscheinungsbild und die Sicherheit deines Kontos."
      >
        <a href="#profile-security" className="rv-section-count">
          <ShieldCheck size={16} aria-hidden="true" /> Kontosicherheit
        </a>
      </WorkspaceHeader>

      <form onSubmit={onSave} className="rv-profile-layout">
        <aside
          className="rv-section-panel rv-profile-identity"
          aria-label="Dein Profil"
        >
          <div className="rv-profile-avatar">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Vorschau deines Profilbilds" />
            ) : (
              (name || user.name || "R").charAt(0)
            )}
          </div>
          <h2>{name || user.name}</h2>
          <p className="rv-profile-email">{user.email}</p>
          <span
            className={`rv-profile-security-badge ${user.twoFactorEnabled ? "rv-profile-security-badge--active" : ""}`}
          >
            <ShieldCheck size={15} aria-hidden="true" />
            {user.twoFactorEnabled ? "2FA aktiv" : "2FA nicht eingerichtet"}
          </span>
          <div className="rv-profile-upload">
            <label htmlFor="profile-image">
              <Upload size={16} aria-hidden="true" /> Profilbild ändern
            </label>
            <input
              id="profile-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-describedby="profile-image-hint"
              onChange={(event) => onImageUpload(event.target.files?.[0])}
            />
            <p id="profile-image-hint" className="rv-form-hint">
              PNG, JPEG oder WebP · maximal 1 MB
            </p>
            {avatarUrl && (
              <button
                type="button"
                className="rv-form-text-danger"
                onClick={() => onAvatarChange(null)}
              >
                Profilbild entfernen
              </button>
            )}
          </div>
          <p className="rv-form-hint">
            Dein Profilbild und deine Angaben werden mit dem Speichern
            übernommen.
          </p>
        </aside>

        <div className="rv-profile-content">
          <WorkspacePanel
            title="Persönliche Angaben"
            description="So erscheinst du für dein Team."
          >
            <div className="rv-form-grid">
              <label className="rv-form-field" htmlFor="profile-name">
                Name
                <input
                  id="profile-name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  className="rv-form-input"
                />
              </label>
              <label className="rv-form-field" htmlFor="profile-language">
                Bevorzugte Sprache
                <select
                  id="profile-language"
                  value={language}
                  onChange={(event) => onLanguageChange(event.target.value)}
                  className="rv-form-input"
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="fr">Français</option>
                </select>
              </label>
            </div>
          </WorkspacePanel>

          <WorkspacePanel
            title="Persönliches Erscheinungsbild"
            description="Passe Farben, Schrift und Abstände an dein Benutzerkonto an."
          >
            <div className="rv-profile-appearance">
              <fieldset
                className="rv-form-actions"
                aria-label="Theme-Vorlage auswählen"
              >
                <button
                  type="button"
                  className="rv-section-button rv-section-button-secondary"
                  onClick={() => onThemeChange(LIGHT_USER_THEME)}
                >
                  Helle Vorlage
                </button>
                <button
                  type="button"
                  className="rv-section-button rv-section-button-secondary"
                  onClick={() => onThemeChange(DEFAULT_USER_THEME)}
                >
                  Dunkle Vorlage
                </button>
              </fieldset>
              <fieldset className="rv-profile-colors">
                <legend>Farben</legend>
                <div className="rv-form-grid">
                  {(
                    [
                      ["backgroundColor", "Hintergrund"],
                      ["surfaceColor", "Flächen"],
                      ["textColor", "Schrift"],
                      ["mutedTextColor", "Sekundärschrift"],
                      ["primaryColor", "Akzentfarbe"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="rv-profile-color">
                      <span>{label}</span>
                      <span>
                        <code>{theme[key]}</code>
                        <input
                          type="color"
                          aria-label={label}
                          value={theme[key]}
                          onChange={(event) =>
                            onThemeChange({
                              ...theme,
                              [key]: event.target.value,
                            })
                          }
                        />
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="rv-form-grid">
                <label className="rv-form-field">
                  Schriftart
                  <select
                    value={theme.fontFamily}
                    onChange={(event) =>
                      onThemeChange({
                        ...theme,
                        fontFamily: event.target
                          .value as UserThemePreferences["fontFamily"],
                      })
                    }
                    className="rv-form-input"
                  >
                    <option value="sans">Sans Serif</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Monospace</option>
                  </select>
                </label>
                <label className="rv-form-field">
                  Abstände
                  <select
                    value={theme.density}
                    onChange={(event) =>
                      onThemeChange({
                        ...theme,
                        density: event.target
                          .value as UserThemePreferences["density"],
                      })
                    }
                    className="rv-form-input"
                  >
                    <option value="compact">Kompakt</option>
                    <option value="comfortable">Komfortabel</option>
                    <option value="spacious">Großzügig</option>
                  </select>
                </label>
                <label className="rv-form-field">
                  Schriftgröße: {theme.fontSize}px
                  <input
                    type="range"
                    min="12"
                    max="20"
                    step="1"
                    value={theme.fontSize}
                    onChange={(event) =>
                      onThemeChange({
                        ...theme,
                        fontSize: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="rv-form-field">
                  Eckenradius: {theme.radius}px
                  <input
                    type="range"
                    min="0"
                    max="24"
                    step="1"
                    value={theme.radius}
                    onChange={(event) =>
                      onThemeChange({
                        ...theme,
                        radius: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <div className="rv-profile-preview-heading">
                <Palette size={16} aria-hidden="true" /> Deine Vorschau
              </div>
              <div
                className="rv-profile-preview"
                style={{
                  background: theme.backgroundColor,
                  color: theme.textColor,
                  fontSize: theme.fontSize,
                  fontFamily:
                    theme.fontFamily === "serif"
                      ? 'Georgia, "Times New Roman", serif'
                      : theme.fontFamily === "mono"
                        ? 'Consolas, "Liberation Mono", monospace'
                        : "Inter, ui-sans-serif, system-ui, sans-serif",
                  borderRadius: theme.radius,
                  padding:
                    theme.density === "compact"
                      ? 12
                      : theme.density === "spacious"
                        ? 28
                        : 20,
                }}
              >
                <div
                  style={{
                    background: theme.surfaceColor,
                    borderRadius: theme.radius,
                    padding:
                      theme.density === "compact"
                        ? 12
                        : theme.density === "spacious"
                          ? 24
                          : 16,
                  }}
                >
                  <span
                    className="rv-profile-preview-icon"
                    style={{ color: theme.primaryColor }}
                  >
                    <UserRound size={22} aria-hidden="true" />
                  </span>
                  <strong>Dein Arbeitsbereich</strong>
                  <p style={{ color: theme.mutedTextColor }}>
                    So wirken deine persönlichen Einstellungen.
                  </p>
                  <span
                    className="rv-profile-preview-accent"
                    style={{ color: theme.primaryColor }}
                  >
                    <Check size={16} aria-hidden="true" /> Deine Akzentfarbe
                  </span>
                </div>
              </div>
            </div>
          </WorkspacePanel>
          <div className="rv-profile-savebar">
            <p className="rv-form-hint">
              Änderungen gelten für dein persönliches Konto.
            </p>
            <button type="submit" className="rv-section-button">
              <Save size={16} aria-hidden="true" /> Profil und Theme speichern
            </button>
          </div>
        </div>
      </form>
      <div id="profile-security" className="rv-profile-security">
        <div className="rv-profile-security-heading">
          <p className="rv-section-eyebrow">KONTOSICHERHEIT</p>
          <h2>Sicherheit &amp; Anmeldung</h2>
          <p className="rv-section-intro">
            Schütze dein Konto mit einem starken Passwort und einer
            Authenticator-App.
          </p>
        </div>
        <ProfileSecuritySettings user={user} onUserChange={onUserChange} />
      </div>
    </div>
  );
}
