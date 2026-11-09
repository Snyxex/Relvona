"use client";
import { AlertCircle } from "lucide-react";
export default function SettingsError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <main>
      <section className="rv-app-state-card">
        <span className="rv-app-state-icon">
          <AlertCircle size={26} aria-hidden="true" />
        </span>
        <h1>Einstellungen nicht verfügbar</h1>
        <p role="alert">
          Einstellungen konnten nicht geladen werden. Bitte versuche es erneut.
        </p>
        <button type="button" className="rv-app-button" onClick={retry}>
          Erneut versuchen
        </button>
      </section>
    </main>
  );
}
