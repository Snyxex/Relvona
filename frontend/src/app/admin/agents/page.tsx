"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bot, History, MessageSquareText, Rocket } from "lucide-react";
import {
  AdminBadge,
  AdminButton,
  AdminEmpty,
  AdminHeader,
  AdminNotice,
  AdminPage,
  AdminPanel,
  adminControlClassName,
} from "@/components/admin/admin-ui";
import { api } from "@/lib/api";

type Assistant = {
  id: string;
  name: string;
  modelProvider: string;
  modelName: string;
  updatedAt: string;
};

type Version = {
  id: string;
  version: number;
  label?: string | null;
  status: string;
  createdAt: string;
  activatedAt?: string | null;
  snapshot: {
    name: string;
    systemPrompt: string;
    modelProvider: string;
    modelName: string;
    temperature: number;
    apiKeyConfigured: boolean;
    activeModelProfileId?: string | null;
  };
};

type PlaygroundResult = {
  versionId: string;
  version: number;
  answer: string;
  detectedLanguage: string;
  confidenceScore: number;
  handoffTriggered: boolean;
  retrievedChunkIds: string[];
  sourcesUsed: string[];
  provider: string;
  model: string;
};

function errorMessage(caught: unknown, fallback: string) {
  const response = caught as { response?: { data?: { error?: string } } };
  return response.response?.data?.error || fallback;
}

export default function AdminAgentsPage() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [assistantId, setAssistantId] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [playgroundVersionId, setPlaygroundVersionId] = useState("");
  const [playgroundMessage, setPlaygroundMessage] = useState("");
  const [playgroundResult, setPlaygroundResult] = useState<PlaygroundResult | null>(
    null,
  );
  const [playgroundLoading, setPlaygroundLoading] = useState(false);

  const loadAssistants = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get("/assistants");
      setAssistants(data);
      setAssistantId((current) => current || data[0]?.id || "");
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Assistants konnten nicht geladen werden."));
    }
  }, []);

  const loadVersions = useCallback(async (id: string) => {
    if (!id) {
      setVersions([]);
      setPlaygroundVersionId("");
      return;
    }
    setError("");
    try {
      const { data } = await api.get("/assistants/" + id + "/versions");
      setVersions(data);
      setPlaygroundVersionId((current) =>
        data.some((version: Version) => version.id === current)
          ? current
          : data[0]?.id || "",
      );
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Versionen konnten nicht geladen werden."));
    }
  }, []);

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  useEffect(() => {
    setPlaygroundResult(null);
    void loadVersions(assistantId);
  }, [assistantId, loadVersions]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assistantId) return;
    setLoading(true);
    setError("");
    try {
      await api.post("/assistants/" + assistantId + "/versions", {
        label: label.trim() || undefined,
      });
      setLabel("");
      await loadVersions(assistantId);
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Version konnte nicht veröffentlicht werden."));
    } finally {
      setLoading(false);
    }
  }

  async function activate(version: Version) {
    if (
      !window.confirm(
        "Version v" +
          version.version +
          " wirklich als Live-Konfiguration aktivieren?",
      )
    ) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.post(
        "/assistants/" +
          assistantId +
          "/versions/" +
          version.id +
          "/activate",
      );
      await Promise.all([loadVersions(assistantId), loadAssistants()]);
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Version konnte nicht aktiviert werden."));
    } finally {
      setLoading(false);
    }
  }

  async function runPlayground(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assistantId || !playgroundVersionId || !playgroundMessage.trim()) {
      return;
    }
    setPlaygroundLoading(true);
    setPlaygroundResult(null);
    setError("");
    try {
      const { data } = await api.post(
        "/assistants/" +
          assistantId +
          "/versions/" +
          playgroundVersionId +
          "/playground",
        { message: playgroundMessage },
      );
      setPlaygroundResult(data);
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Playground konnte nicht ausgeführt werden."));
    } finally {
      setPlaygroundLoading(false);
    }
  }

  const selected = assistants.find((assistant) => assistant.id === assistantId);

  return (
    <AdminPage>
      <AdminHeader
        eyebrow="KI & Wissen / Agent-Versionen"
        title="Versionen & Playground"
        description="Live-Konfigurationen einfrieren, mit echten Wissensdaten testen und kontrolliert zurückrollen."
        icon={Bot}
      />
      {error && <AdminNotice tone="error">{error}</AdminNotice>}

      <AdminPanel
        title="Assistant auswählen"
        description="Die Versionsverwaltung bezieht sich immer auf den ausgewählten Assistant."
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="min-w-0 flex-1 space-y-2 text-sm text-[#536584] sm:max-w-md">
            <span className="block font-medium">Assistant</span>
            <select
              value={assistantId}
              onChange={(event) => setAssistantId(event.target.value)}
              className={adminControlClassName}
            >
              {!assistants.length && (
                <option value="">Kein Assistant vorhanden</option>
              )}
              {assistants.map((assistant) => (
                <option key={assistant.id} value={assistant.id}>
                  {assistant.name}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <div className="space-y-1 text-sm text-[#667694]">
              <p>
                Live: {selected.modelProvider} / {selected.modelName}
              </p>
              <p>
                Geändert: {new Date(selected.updatedAt).toLocaleString("de-DE")}
              </p>
            </div>
          )}
        </div>
      </AdminPanel>

      {assistantId && (
        <AdminPanel
          title="Aktuellen Stand veröffentlichen"
          description="Erstellt einen unveränderlichen Snapshot der Runtime-Konfiguration. Provider-Secrets bleiben verschlüsselt und werden nicht im UI angezeigt."
        >
          <form onSubmit={publish} className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 space-y-2 text-sm text-[#536584]">
              <span className="block font-medium">Versionslabel (optional)</span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={120}
                placeholder="z. B. Stable November"
                className={adminControlClassName}
              />
            </label>
            <AdminButton type="submit" disabled={loading}>
              <Rocket size={16} aria-hidden="true" />
              {loading ? "Verarbeitet…" : "Version veröffentlichen"}
            </AdminButton>
          </form>
        </AdminPanel>
      )}

      {versions.length > 0 && (
        <AdminPanel
          title="Playground"
          description="Testet eine veröffentlichte Version mit der echten Knowledge Base, ohne Conversation-, Ticket- oder Customer-Daten zu schreiben. Die Modellnutzung zählt gegen das normale Tenant-Budget."
        >
          <form onSubmit={runPlayground} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
              <label className="space-y-2 text-sm text-[#536584]">
                <span className="block font-medium">Version</span>
                <select
                  value={playgroundVersionId}
                  onChange={(event) => {
                    setPlaygroundVersionId(event.target.value);
                    setPlaygroundResult(null);
                  }}
                  className={adminControlClassName}
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version}
                      {version.label ? " · " + version.label : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm text-[#536584]">
                <span className="block font-medium">Testfrage</span>
                <input
                  required
                  maxLength={6000}
                  value={playgroundMessage}
                  onChange={(event) => setPlaygroundMessage(event.target.value)}
                  placeholder="Testfrage an diese Version"
                  className={adminControlClassName}
                />
              </label>
            </div>
            <AdminButton
              type="submit"
              disabled={playgroundLoading || !playgroundVersionId}
            >
              <MessageSquareText size={16} aria-hidden="true" />
              {playgroundLoading ? "Test läuft…" : "Version testen"}
            </AdminButton>
          </form>
          {playgroundResult && (
            <div
              aria-live="polite"
              className="space-y-4 rounded-xl border border-[#e5eaf3] bg-[#f8faff] p-4"
            >
              <div className="flex flex-wrap gap-3 text-xs text-[#667694]">
                <span>v{playgroundResult.version}</span>
                <span>
                  {playgroundResult.provider} / {playgroundResult.model}
                </span>
                <span>
                  Confidence{" "}
                  {Math.round(playgroundResult.confidenceScore * 100)} %
                </span>
                <span>
                  {playgroundResult.handoffTriggered
                    ? "Handoff würde ausgelöst"
                    : "kein Handoff"}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-[#172742]">
                {playgroundResult.answer}
              </p>
              <p className="text-xs text-[#667694]">
                Quellen:{" "}
                {playgroundResult.sourcesUsed.length
                  ? playgroundResult.sourcesUsed.join(", ")
                  : "keine"}
              </p>
            </div>
          )}
        </AdminPanel>
      )}

      <AdminPanel
        title="Versionshistorie"
        description="Veröffentlichte Snapshots, neueste zuerst."
      >
        {versions.length === 0 ? (
          <AdminEmpty
            icon={History}
            title="Noch keine veröffentlichte Version vorhanden"
            description="Veröffentliche einen Snapshot, um Versionen vergleichen und bei Bedarf zurückrollen zu können."
          />
        ) : (
          <div className="space-y-3">
            {versions.map((version) => (
              <article
                key={version.id}
                className="rounded-xl border border-[#e5eaf3] bg-[#f8faff] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[#172742]">
                        v{version.version}
                      </h3>
                      {version.label && (
                        <span className="text-sm text-[#536584]">
                          {version.label}
                        </span>
                      )}
                      <AdminBadge
                        tone={version.status === "active" ? "success" : "neutral"}
                      >
                        {version.status}
                      </AdminBadge>
                    </div>
                    <p className="text-sm text-[#536584]">
                      {version.snapshot.modelProvider} /{" "}
                      {version.snapshot.modelName} · Temperatur{" "}
                      {version.snapshot.temperature}
                    </p>
                    <p className="text-xs text-[#667694]">
                      Prompt: {version.snapshot.systemPrompt.slice(0, 180)}
                      {version.snapshot.systemPrompt.length > 180 ? "…" : ""}
                    </p>
                    <p className="text-xs text-[#667694]">
                      Erstellt:{" "}
                      {new Date(version.createdAt).toLocaleString("de-DE")}
                      {version.activatedAt
                        ? " · Aktiviert: " +
                          new Date(version.activatedAt).toLocaleString("de-DE")
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <AdminButton
                      variant="secondary"
                      onClick={() => {
                        setPlaygroundVersionId(version.id);
                        setPlaygroundResult(null);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Testen
                    </AdminButton>
                    <AdminButton
                      variant="secondary"
                      disabled={loading || version.status === "active"}
                      onClick={() => void activate(version)}
                    >
                      {version.status === "active"
                        ? "Aktiv"
                        : "Aktivieren / Rollback"}
                    </AdminButton>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </AdminPanel>
    </AdminPage>
  );
}
