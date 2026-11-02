"use client";

import type { FormEventHandler } from "react";
import { RefreshCw } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { WorkspaceHeader } from "./workspace-primitives";

export const DEFAULT_WIDGET_SETTINGS = {
  primaryColor: "#3B82F6",
  backgroundColor: "#F8FAFC",
  surfaceColor: "#FFFFFF",
  agentBubbleColor: "#E2E8F0",
  textColor: "#0F172A",
  borderRadius: 16,
  launcherRadius: 30,
  launcherSize: 60,
  windowWidth: 380,
  offset: 24,
  position: "bottom-right",
  fontFamily: "sans",
  launcherIcon: "💬",
  headerTitle: "",
  inputPlaceholder: "Wie können wir helfen?",
  sendLabel: "Senden",
};

export type WidgetAssistant = {
  id: string;
  name?: string;
  welcomeMessage?: string;
  widgetApiKey?: string;
  widgetAllowedOrigins?: string[];
  chatPageEnabled?: boolean;
  widgetSettings?: Partial<typeof DEFAULT_WIDGET_SETTINGS>;
  [field: string]: unknown;
};

type Props = {
  assistant: WidgetAssistant;
  onChange: (value: WidgetAssistant) => void;
  onSave: FormEventHandler<HTMLFormElement>;
  onRotateKey: () => void;
};

export default function WidgetDesigner({ assistant, onChange, onSave, onRotateKey }: Props) {
  const widgetSettings = {
    ...DEFAULT_WIDGET_SETTINGS,
    ...(assistant.widgetSettings || {}),
  };
  const updateWidgetSetting = (key: string, value: string | number) => {
    onChange({
      ...assistant,
      widgetSettings: { ...widgetSettings, [key]: value },
    });
  };

  return (
    <div className="rv-widget-workspace rv-config-workspace mx-auto max-w-5xl space-y-6">
                <WorkspaceHeader eyebrow="KANÄLE" title="Widget-Designer"
                  description="Gestalte den Kundenchat und überprüfe jede Änderung direkt in der Vorschau." />
    
                <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
                  <form
                    onSubmit={onSave}
                    className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          Erscheinungsbild
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">
                          Die Einstellungen gelten für alle eingebundenen Widgets
                          dieses Assistenten.
                        </p>
                      </div>
                      <button
                        type="submit"
                        className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                      >
                        Design speichern
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {[
                        ["primaryColor", "Akzentfarbe"],
                        ["backgroundColor", "Chat-Hintergrund"],
                        ["surfaceColor", "Flächen"],
                        ["agentBubbleColor", "KI-Nachrichten"],
                        ["textColor", "Textfarbe"],
                      ].map(([key, label]) => (
                        <label key={key} className="space-y-1">
                          <span className="block text-[11px] font-medium text-slate-400">
                            {label}
                          </span>
                          <div className="flex rounded border border-slate-700 bg-slate-800 p-1">
                            <input
                              type="color"
                              value={String(
                                widgetSettings[key as keyof typeof widgetSettings],
                              )}
                              onChange={(e) =>
                                updateWidgetSetting(key, e.target.value)
                              }
                              className="h-7 w-9 cursor-pointer bg-transparent"
                            />
                            <input
                              value={String(
                                widgetSettings[key as keyof typeof widgetSettings],
                              )}
                              onChange={(e) =>
                                updateWidgetSetting(key, e.target.value)
                              }
                              className="min-w-0 flex-1 bg-transparent px-1 text-xs text-slate-200 outline-none"
                            />
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="block text-[11px] font-medium text-slate-400">
                          Schriftart
                        </span>
                        <select
                          value={widgetSettings.fontFamily}
                          onChange={(e) =>
                            updateWidgetSetting("fontFamily", e.target.value)
                          }
                          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"
                        >
                          <option value="sans">Modern Sans</option>
                          <option value="serif">Klassisch Serif</option>
                          <option value="mono">Monospace</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] font-medium text-slate-400">
                          Position
                        </span>
                        <select
                          value={widgetSettings.position}
                          onChange={(e) =>
                            updateWidgetSetting("position", e.target.value)
                          }
                          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"
                        >
                          <option value="bottom-right">Unten rechts</option>
                          <option value="bottom-left">Unten links</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] font-medium text-slate-400">
                          Überschrift
                        </span>
                        <input
                          maxLength={80}
                          value={widgetSettings.headerTitle}
                          placeholder={assistant.name}
                          onChange={(e) =>
                            updateWidgetSetting("headerTitle", e.target.value)
                          }
                          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] font-medium text-slate-400">
                          Launcher-Symbol
                        </span>
                        <input
                          maxLength={4}
                          value={widgetSettings.launcherIcon}
                          onChange={(e) =>
                            updateWidgetSetting("launcherIcon", e.target.value)
                          }
                          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] font-medium text-slate-400">
                          Eingabe-Hinweis
                        </span>
                        <input
                          maxLength={120}
                          value={widgetSettings.inputPlaceholder}
                          onChange={(e) =>
                            updateWidgetSetting("inputPlaceholder", e.target.value)
                          }
                          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] font-medium text-slate-400">
                          Senden-Text
                        </span>
                        <input
                          maxLength={30}
                          value={widgetSettings.sendLabel}
                          onChange={(e) =>
                            updateWidgetSetting("sendLabel", e.target.value)
                          }
                          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"
                        />
                      </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        ["borderRadius", "Fenster-Rundung", 0, 32],
                        ["launcherSize", "Button-Größe", 44, 80],
                        ["windowWidth", "Fenster-Breite", 300, 520],
                        ["offset", "Abstand zum Rand", 12, 48],
                      ].map(([key, label, min, max]) => (
                        <label key={String(key)} className="space-y-2">
                          <span className="flex justify-between text-[11px] font-medium text-slate-400">
                            <span>{label}</span>
                            <span>
                              {widgetSettings[key as keyof typeof widgetSettings]}{" "}
                              px
                            </span>
                          </span>
                          <input
                            type="range"
                            min={Number(min)}
                            max={Number(max)}
                            value={Number(
                              widgetSettings[key as keyof typeof widgetSettings],
                            )}
                            onChange={(e) =>
                              updateWidgetSetting(
                                String(key),
                                Number(e.target.value),
                              )
                            }
                            className="w-full accent-blue-500"
                          />
                        </label>
                      ))}
                    </div>
                  </form>
    
                  <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                    <h2 className="text-sm font-semibold text-white">
                      Live-Vorschau
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      So erscheint der Chat auf deiner Website.
                    </p>
                    <div
                      className="relative mt-4 h-[500px] overflow-hidden rounded-lg border border-slate-700 bg-slate-800"
                      style={{
                        background: "linear-gradient(135deg, #e2e8f0, #cbd5e1)",
                      }}
                    >
                      <div className="absolute inset-5 rounded-md border border-white/60 bg-white/30" />
                      <div
                        className={`absolute bottom-4 ${
                          widgetSettings.position === "bottom-left"
                            ? "left-4"
                            : "right-4"
                        }`}
                      >
                        <div
                          className="mb-3 w-[280px] overflow-hidden shadow-2xl"
                          style={{
                            borderRadius: Number(widgetSettings.borderRadius),
                            fontFamily:
                              widgetSettings.fontFamily === "serif"
                                ? "Georgia, serif"
                                : widgetSettings.fontFamily === "mono"
                                  ? "monospace"
                                  : "Arial, sans-serif",
                            backgroundColor: widgetSettings.surfaceColor,
                          }}
                        >
                          <div
                            className="px-4 py-3 text-sm font-semibold text-white"
                            style={{ backgroundColor: widgetSettings.primaryColor }}
                          >
                            {widgetSettings.headerTitle || assistant.name}
                            <span className="float-right">×</span>
                          </div>
                          <div
                            className="space-y-3 p-3"
                            style={{
                              backgroundColor: widgetSettings.backgroundColor,
                            }}
                          >
                            <div
                              className="max-w-[82%] rounded-xl rounded-bl-sm px-3 py-2 text-xs"
                              style={{
                                backgroundColor: widgetSettings.agentBubbleColor,
                                color: widgetSettings.textColor,
                              }}
                            >
                              {assistant.welcomeMessage ||
                                "Hallo! Wie kann ich helfen?"}
                            </div>
                            <div
                              className="ml-auto max-w-[74%] rounded-xl rounded-br-sm px-3 py-2 text-xs text-white"
                              style={{
                                backgroundColor: widgetSettings.primaryColor,
                              }}
                            >
                              Ich brauche Hilfe.
                            </div>
                          </div>
                          <div
                            className="flex gap-2 border-t p-2"
                            style={{ backgroundColor: widgetSettings.surfaceColor }}
                          >
                            <div className="flex-1 rounded border border-slate-300 px-2 py-2 text-[10px] text-slate-400">
                              {widgetSettings.inputPlaceholder}
                            </div>
                            <div
                              className="rounded px-2 py-2 text-[10px] font-semibold text-white"
                              style={{
                                backgroundColor: widgetSettings.primaryColor,
                              }}
                            >
                              {widgetSettings.sendLabel}
                            </div>
                          </div>
                        </div>
                        <div
                          className="flex items-center justify-center text-xl text-white shadow-lg"
                          style={{
                            width: Number(widgetSettings.launcherSize),
                            height: Number(widgetSettings.launcherSize),
                            borderRadius: Number(widgetSettings.launcherRadius),
                            backgroundColor: widgetSettings.primaryColor,
                          }}
                        >
                          {widgetSettings.launcherIcon || "💬"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
    
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
                  <h3 className="block text-xs font-semibold text-slate-300 uppercase">
                    Integration Snippet
                  </h3>
                  <pre className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs font-mono text-blue-300 overflow-x-auto">
                    {`<script\n  src="${API_BASE_URL.replace("/api/v1", "")}/public/widget.js"\n  data-assistant-id="${assistant.id}"\n  data-widget-key="${assistant.widgetApiKey}"\n  data-api-base="${API_BASE_URL.replace("/api/v1", "")}"\n></script>`}
                  </pre>
                </div>
    
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="block text-xs font-semibold text-slate-300 uppercase">
                        Public Widget Integration Key
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Rotate immediately if it is exposed. Rotation invalidates
                        existing embeds.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onRotateKey}
                      className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Rotate
                    </button>
                  </div>
                  <input
                    readOnly
                    value={assistant.widgetApiKey || ""}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs font-mono text-emerald-400"
                  />
                </div>
    
                <form
                  onSubmit={onSave}
                  className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4"
                >
                  <div>
                    <label
                      htmlFor="support-field-22"
                      className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                    >
                      Allowed Website Origins
                    </label>
                    <textarea
                      id="support-field-22"
                      value={(assistant.widgetAllowedOrigins || []).join(
                        "\n",
                      )}
                      onChange={(e) =>
                        onChange({
                          ...assistant,
                          widgetAllowedOrigins: e.target.value
                            .split("\n")
                            .map((origin) => origin.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder={
                        "https://www.example.com\nhttps://shop.example.com"
                      }
                      className="w-full h-24 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      One exact origin per line. Leave empty only for
                      server-to-server or development integrations.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={Boolean(assistant.chatPageEnabled)}
                      onChange={(e) =>
                        onChange({
                          ...assistant,
                          chatPageEnabled: e.target.checked,
                        })
                      }
                    />{" "}
                    Enable a hosted chatbot page
                  </label>
                  {assistant.chatPageEnabled && (
                    <div>
                      <label
                        htmlFor="support-field-23"
                        className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                      >
                        Hosted Chat Page URL
                      </label>
                      <input
                        id="support-field-23"
                        readOnly
                        value={`${API_BASE_URL}/widget/page/${assistant.id}?widgetKey=${assistant.widgetApiKey}`}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs font-mono text-blue-300"
                      />
                    </div>
                  )}
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded"
                  >
                    Save Widget Access Settings
                  </button>
                </form>
              </div>
  );
}
