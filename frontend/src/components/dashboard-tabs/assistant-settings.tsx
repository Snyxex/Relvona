"use client";

import type { FormEventHandler } from "react";
import { Plus, Trash2 } from "lucide-react";
import { WorkspaceHeader } from "./workspace-primitives";

export type ModelProfile = {
  id: string;
  label?: string;
  provider: string;
  modelName: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
};

export type AssistantConfig = {
  id: string;
  modelProfiles?: ModelProfile[];
  activeModelProfileId?: string | null;
  name?: string;
  modelProvider?: string;
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  systemPrompt?: string;
  [field: string]: unknown;
};

type Props = {
  assistant: AssistantConfig;
  onChange: (assistant: AssistantConfig) => void;
  onSave: FormEventHandler<HTMLFormElement>;
};

/** Model/provider and guardrail editing; no tenant fetches are performed here. */
export default function AssistantSettings({
  assistant,
  onChange,
  onSave,
}: Props) {
  return (
    <div className="rv-assistant-workspace rv-config-workspace space-y-6 max-w-4xl mx-auto">
      <WorkspaceHeader
        eyebrow="AI-KONFIGURATION"
        title="AI-Assistent"
        description="Verwalte Modellanbieter, aktive Profile, API-Schlüssel und Systemanweisungen."
      />

      <div className="rounded-xl border border-blue-800/70 bg-blue-950/30 p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">
            Aktiv für neue Antworten
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {(assistant.modelProfiles || []).find(
              (profile: ModelProfile) =>
                profile.id === assistant.activeModelProfileId,
            )?.label || "Standard-Konfiguration"}
          </p>
          <p className="text-xs text-slate-400">
            {(assistant.modelProfiles || []).find(
              (profile: ModelProfile) =>
                profile.id === assistant.activeModelProfileId,
            )?.provider || assistant.modelProvider}{" "}
            ·{" "}
            {(assistant.modelProfiles || []).find(
              (profile: ModelProfile) =>
                profile.id === assistant.activeModelProfileId,
            )?.modelName || assistant.modelName}
          </p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
          Live
        </span>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Modell- & Provider-Konfigurationen
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              API-Schlüssel werden verschlüsselt gespeichert und nach dem
              Speichern nicht erneut angezeigt.
            </p>
          </div>
          <button
            type="button"
            disabled={(assistant.modelProfiles || []).length >= 8}
            onClick={() => {
              const id = `model_${Date.now().toString(36)}`;
              onChange({
                ...assistant,
                modelProfiles: [
                  ...(assistant.modelProfiles || []),
                  {
                    id,
                    label: "Neue Konfiguration",
                    provider: "openai",
                    modelName: "gpt-4o-mini",
                    baseUrl: "",
                    apiKey: "",
                  },
                ],
              });
            }}
            className="shrink-0 rounded bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" /> Hinzufügen
          </button>
        </div>
        {(assistant.modelProfiles || []).length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-700 p-4 text-xs text-slate-400">
            Zurzeit wird die Standard-Konfiguration unten verwendet. Füge eine
            Konfiguration hinzu, um etwa OpenAI, Claude, Gemini oder ein lokales
            Modell hinterlegen zu können.
          </div>
        )}
        {(assistant.modelProfiles || []).map(
          (profile: ModelProfile, index: number) => (
            <div
              key={profile.id}
              className={`rounded-lg border p-4 ${
                assistant.activeModelProfileId === profile.id
                  ? "border-blue-600 bg-blue-950/20"
                  : "border-slate-700 bg-slate-800/50"
              }`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <input
                    type="radio"
                    name="active-model-profile"
                    checked={assistant.activeModelProfileId === profile.id}
                    onChange={() =>
                      onChange({
                        ...assistant,
                        activeModelProfileId: profile.id,
                      })
                    }
                  />{" "}
                  Diese Konfiguration aktiv verwenden
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const modelProfiles = (
                      assistant.modelProfiles || []
                    ).filter((item: ModelProfile) => item.id !== profile.id);
                    onChange({
                      ...assistant,
                      modelProfiles,
                      activeModelProfileId:
                        assistant.activeModelProfileId === profile.id
                          ? null
                          : assistant.activeModelProfileId,
                    });
                  }}
                  className="text-slate-500 hover:text-red-300"
                  title="Konfiguration entfernen"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-slate-400">
                    Name der Konfiguration
                  </span>
                  <input
                    value={profile.label || ""}
                    maxLength={60}
                    onChange={(e) =>
                      onChange({
                        ...assistant,
                        modelProfiles: (assistant.modelProfiles || []).map(
                          (item: ModelProfile) =>
                            item.id === profile.id
                              ? { ...item, label: e.target.value }
                              : item,
                        ),
                      })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-slate-400">
                    Provider
                  </span>
                  <select
                    value={profile.provider}
                    onChange={(e) =>
                      onChange({
                        ...assistant,
                        modelProfiles: (assistant.modelProfiles || []).map(
                          (item: ModelProfile) =>
                            item.id === profile.id
                              ? { ...item, provider: e.target.value }
                              : item,
                        ),
                      })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google Gemini</option>
                    <option value="nvidia">NVIDIA NIM</option>
                    <option value="local">Local / Ollama / LocalAI</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-slate-400">
                    Modell
                  </span>
                  <input
                    value={profile.modelName || ""}
                    maxLength={160}
                    placeholder="z. B. gpt-4o-mini"
                    onChange={(e) =>
                      onChange({
                        ...assistant,
                        modelProfiles: (assistant.modelProfiles || []).map(
                          (item: ModelProfile) =>
                            item.id === profile.id
                              ? { ...item, modelName: e.target.value }
                              : item,
                        ),
                      })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-slate-400">
                    API-Schlüssel{" "}
                    {profile.apiKeyConfigured ? "(gespeichert)" : ""}
                  </span>
                  <input
                    type="password"
                    value={profile.apiKey || ""}
                    placeholder={
                      profile.apiKeyConfigured
                        ? "Unverändert lassen"
                        : "API-Schlüssel eingeben"
                    }
                    onChange={(e) =>
                      onChange({
                        ...assistant,
                        modelProfiles: (assistant.modelProfiles || []).map(
                          (item: ModelProfile) =>
                            item.id === profile.id
                              ? { ...item, apiKey: e.target.value }
                              : item,
                        ),
                      })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
                  />
                </label>
                {profile.provider === "local" && (
                  <label className="md:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium text-slate-400">
                      Lokale Base URL
                    </span>
                    <input
                      value={profile.baseUrl || ""}
                      placeholder="http://localhost:11434/v1"
                      onChange={(e) =>
                        onChange({
                          ...assistant,
                          modelProfiles: (assistant.modelProfiles || []).map(
                            (item: ModelProfile) =>
                              item.id === profile.id
                                ? { ...item, baseUrl: e.target.value }
                                : item,
                          ),
                        })
                      }
                      className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
                    />
                  </label>
                )}
              </div>
              <p className="mt-3 text-[10px] text-slate-500">
                Konfiguration {index + 1} · Änderungen mit „Save Universal AI
                Gateway Settings“ speichern.
              </p>
            </div>
          ),
        )}
      </div>

      <form
        onSubmit={onSave}
        className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="support-field-15"
              className="block text-xs font-semibold text-slate-300 uppercase mb-1"
            >
              Assistant Name
            </label>
            <input
              id="support-field-15"
              type="text"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
              value={assistant.name || ""}
              onChange={(e) =>
                onChange({
                  ...assistant,
                  name: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label
              htmlFor="support-field-16"
              className="block text-xs font-semibold text-slate-300 uppercase mb-1"
            >
              AI Provider Gateway
            </label>
            <select
              id="support-field-16"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-semibold text-blue-400"
              value={assistant.modelProvider || "openai"}
              onChange={(e) =>
                onChange({
                  ...assistant,
                  modelProvider: e.target.value,
                })
              }
            >
              <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
              <option value="anthropic">
                Anthropic (Claude 3.5 Sonnet / Haiku / Opus)
              </option>
              <option value="google">
                Google Gemini (Gemini 1.5 Flash / Pro / 2.0)
              </option>
              <option value="nvidia">NVIDIA NIM (Llama 3.1 8B / 70B)</option>
              <option value="local">
                Local / Ollama / LocalAI (OpenAI-compatible)
              </option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="support-field-17"
              className="block text-xs font-semibold text-slate-300 uppercase mb-1"
            >
              Model Name
            </label>
            <input
              id="support-field-17"
              type="text"
              placeholder={
                assistant.modelProvider === "anthropic"
                  ? "claude-3-5-sonnet-20241022"
                  : assistant.modelProvider === "google"
                    ? "gemini-1.5-flash"
                    : assistant.modelProvider === "nvidia"
                      ? "nvidia/llama-3.1-8b-instruct"
                      : assistant.modelProvider === "local"
                        ? "llama3"
                        : "gpt-4o-mini"
              }
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-mono text-slate-200"
              value={assistant.modelName || ""}
              onChange={(e) =>
                onChange({
                  ...assistant,
                  modelName: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label
              htmlFor="support-field-18"
              className="block text-xs font-semibold text-slate-300 uppercase mb-1"
            >
              Custom API Key (Optional Override)
            </label>
            <input
              id="support-field-18"
              type="password"
              placeholder="sk-..."
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-mono text-slate-200"
              value={assistant.apiKey || ""}
              onChange={(e) =>
                onChange({
                  ...assistant,
                  apiKey: e.target.value,
                })
              }
            />
          </div>
        </div>

        {assistant.modelProvider === "local" && (
          <div>
            <label
              htmlFor="support-field-19"
              className="block text-xs font-semibold text-slate-300 uppercase mb-1"
            >
              Custom Endpoint Base URL (Local/Ollama/LocalAI)
            </label>
            <input
              id="support-field-19"
              type="text"
              placeholder="http://localhost:11434/v1"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-mono text-amber-400"
              value={assistant.baseUrl || ""}
              onChange={(e) =>
                onChange({
                  ...assistant,
                  baseUrl: e.target.value,
                })
              }
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Specify your custom Ollama or LocalAI OpenAI-compatible API base
              URL.
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="support-field-20"
            className="block text-xs font-semibold text-slate-300 uppercase mb-1"
          >
            Temperature ({assistant.temperature})
          </label>
          <input
            id="support-field-20"
            type="range"
            min="0"
            max="1"
            step="0.05"
            className="w-full"
            value={assistant.temperature ?? 0.2}
            onChange={(e) =>
              onChange({
                ...assistant,
                temperature: parseFloat(e.target.value),
              })
            }
          />
        </div>

        <div>
          <label
            htmlFor="support-field-21"
            className="block text-xs font-semibold text-slate-300 uppercase mb-1"
          >
            System Prompt Guardrails
          </label>
          <textarea
            id="support-field-21"
            rows={4}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
            value={assistant.systemPrompt || ""}
            onChange={(e) =>
              onChange({
                ...assistant,
                systemPrompt: e.target.value,
              })
            }
          />
        </div>

        <button
          type="submit"
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs"
        >
          Save Universal AI Gateway Settings
        </button>
      </form>
    </div>
  );
}
