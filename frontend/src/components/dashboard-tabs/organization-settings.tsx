"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { WorkspaceHeader } from "@/components/dashboard-tabs/workspace-primitives";

type OrganizationSettingsProps = {
  organizationId: string;
  apiKey: string | null | undefined;
  onKeyRotated: (organizationId: string, apiKey: string) => void;
  notify: (message: string) => void;
};

/**
 * The API key is intentionally never persisted by this component.
 * Unmounting it (including switching organizations) hides the key immediately.
 */
export default function OrganizationSettings({
  organizationId,
  apiKey,
  onKeyRotated,
  notify,
}: OrganizationSettingsProps) {
  const [visible, setVisible] = useState(false);
  const [rotating, setRotating] = useState(false);

  async function rotateKey() {
    if (rotating) return;
    const confirmed = window.confirm(
      "Organisations-API-Schlüssel wirklich erneuern? Der bisherige Schlüssel wird ungültig und bestehende Integrationen müssen aktualisiert werden.",
    );
    if (!confirmed) return;

    setVisible(false);
    setRotating(true);
    try {
      const { data } = await api.post<{ apiKey: string }>(
        "/organizations/api-key",
      );
      if (typeof data.apiKey !== "string" || !data.apiKey) {
        throw new Error(
          "Der Server hat keinen neuen API-Schlüssel zurückgegeben.",
        );
      }
      onKeyRotated(organizationId, data.apiKey);
      notify(
        "Neuer Organisations-API-Schlüssel erstellt. Bestehende Integrationen müssen aktualisiert werden.",
      );
    } catch {
      notify(
        "Der API-Schlüssel konnte nicht erneuert werden. Bitte erneut versuchen.",
      );
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="rv-settings-workspace rv-config-workspace mx-auto max-w-4xl space-y-6">
      <WorkspaceHeader
        eyebrow="ORGANISATION"
        title="Organisationseinstellungen"
        description="Verwalte deine Organisationsidentität und den API-Zugriff."
      />
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <label
          htmlFor="rv-organization-api-key"
          className="text-xs font-semibold uppercase text-slate-400"
        >
          Organisations-API-Schlüssel
        </label>
        <p className="rv-config-key-advice">
          Schlüssel nur bei Bedarf anzeigen. Eine Erneuerung macht den
          bisherigen Schlüssel ungültig.
        </p>
        <div className="rv-api-key-actions mt-2 flex gap-2">
          <input
            id="rv-organization-api-key"
            type={visible ? "text" : "password"}
            value={apiKey ?? ""}
            readOnly
            autoComplete="off"
            spellCheck={false}
            aria-label="Organisations-API-Schlüssel"
            className="min-w-0 flex-1 rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-amber-400"
          />
          <button
            type="button"
            className="rv-api-visibility rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
            disabled={!apiKey || rotating}
            onClick={() => setVisible((value) => !value)}
            aria-pressed={visible}
          >
            {visible ? "Verbergen" : "Anzeigen"}
          </button>
          <button
            type="button"
            disabled={rotating}
            onClick={() => {
              void rotateKey();
            }}
            className="flex items-center gap-1 rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            <RefreshCw size={14} aria-hidden="true" />
            {rotating ? "Wird erneuert …" : "Neu generieren"}
          </button>
        </div>
      </section>
    </div>
  );
}
