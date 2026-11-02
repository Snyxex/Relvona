"use client";

import { memo } from "react";
import { Bot, BrainCircuit, MessageSquare, RefreshCw, Ticket, Users } from "lucide-react";
import { aiResolutionPercent, distributionPercent } from "@/lib/support-metrics";
import {
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspaceMetric,
  WorkspacePanel,
} from "./workspace-primitives";

type AnalyticsMetrics = {
  totalConversations?: number;
  aiResolved?: number;
  handoffs?: number;
  openTickets?: number;
  totalKnowledgeSources?: number;
  totalDocumentChunks?: number;
  stateBreakdown?: Record<string, number>;
  languageBreakdown?: { language: string | null; count: number }[];
};

const STATE_LABELS: Record<string, string> = {
  AI_ACTIVE: "AI bearbeitet",
  WAITING_FOR_AGENT: "Wartet auf Mitarbeiter",
  NEEDS_HUMAN: "Mitarbeiter benötigt",
  AGENT_ACTIVE: "Mitarbeiter aktiv",
  WAITING_FOR_CUSTOMER: "Wartet auf Kunden",
  RESOLVED: "Gelöst",
  CLOSED: "Geschlossen",
};
const STATE_COLORS = ["#5179fb", "#9167f4", "#4fc0eb", "#36bea9", "#e3aa5c", "#91a3c1"];
const STATE_TONES: Record<string, string> = {
  AI_ACTIVE: "#5179fb",
  WAITING_FOR_AGENT: "#f1b65f",
  NEEDS_HUMAN: "#e3aa5c",
  AGENT_ACTIVE: "#9167f4",
  WAITING_FOR_CUSTOMER: "#4fc0eb",
  RESOLVED: "#36bea9",
  CLOSED: "#91a3c1",
};

const count = (value: number | undefined) => Math.max(0, Number(value) || 0);
const displayCount = (value: number | undefined) => new Intl.NumberFormat("de-DE").format(count(value));

function AnalyticsTab({
  overviewMetrics,
  onRefresh,
}: {
  overviewMetrics: AnalyticsMetrics | null;
  onRefresh: () => void;
}) {
  const data = overviewMetrics;
  if (!data) {
    return (
      <div className="rv-section-page">
        <WorkspaceHeader eyebrow="INSIGHTS" title="Analytics & Performance"
          description="Supportaufkommen, AI-Automatisierung und Wissen im Überblick.">
          <button type="button" className="rv-section-button rv-section-button-secondary" onClick={onRefresh}>
            <RefreshCw size={15} aria-hidden="true" />Aktualisieren
          </button>
        </WorkspaceHeader>
        <WorkspacePanel>
          <WorkspaceEmpty icon={BrainCircuit} title="Keine Analytics-Daten geladen"
            description="Die Kennzahlen sind noch nicht verfügbar. Du kannst die Auswertung erneut laden." />
        </WorkspacePanel>
      </div>
    );
  }
  const conversationCount = count(data.totalConversations);
  // Overall resolution includes human-handled cases; AI events are tracked separately.
  const aiResolutionRate = aiResolutionPercent(data.aiResolved, conversationCount);
  const displayedRate = aiResolutionRate === null ? "—" : `${aiResolutionRate}%`;
  const handoffs = count(data?.handoffs);
  const states = Object.entries(data?.stateBreakdown ?? {}).sort((a, b) => b[1] - a[1]);
  const languages = [...(data?.languageBreakdown ?? [])].sort((a, b) => b.count - a.count);
  const languageCount = languages.reduce((sum, value) => sum + count(value.count), 0);

  return (
    <div className="rv-section-page">
      <WorkspaceHeader
        eyebrow="INSIGHTS"
        title="Analytics & Performance"
        description="Supportaufkommen, AI-Automatisierung und Wissen im Überblick."
      >
        <button type="button" className="rv-section-button rv-section-button-secondary" onClick={onRefresh}>
          <RefreshCw size={15} aria-hidden="true" />
          Aktualisieren
        </button>
      </WorkspaceHeader>

      <div className="rv-section-kpis">
        <WorkspaceMetric label="Unterhaltungen" value={displayCount(data?.totalConversations)} icon={MessageSquare} tone="blue" />
        <WorkspaceMetric label="AI-Lösungsquote" value={displayedRate} icon={BrainCircuit} tone="mint" />
        <WorkspaceMetric label="Aktueller Agentenbedarf" value={displayCount(data?.handoffs)} icon={Users} tone="amber" />
        <WorkspaceMetric label="Offene Tickets" value={displayCount(data?.openTickets)} icon={Ticket} tone="violet" />
      </div>

      <div className="rv-section-grid rv-section-grid-three">
        <WorkspacePanel title="AI-Automatisierung" description="Ohne menschliche Übergabe gelöste Gespräche">
          <div className="rv-insight-donut-row">
            <div
              className="rv-insight-donut"
              style={{ background: `conic-gradient(#38bfa9 ${aiResolutionRate ?? 0}%, #edf1f7 0)` }}
              role="img"
              aria-label={`AI-Lösungsquote: ${displayedRate}`}
            >
              <span><strong>{displayedRate}</strong><small>AI-gelöst</small></span>
            </div>
            <p>Anteil der Unterhaltungen mit einem erfassten AI-Lösungsereignis.</p>
          </div>
        </WorkspacePanel>
        <WorkspacePanel title="Mitarbeiterbedarf" description="Gespräche, die aktuell beim Support-Team liegen">
          <div className="rv-insight-number">{displayCount(data?.handoffs)}</div>
          <p className="rv-insight-description">Unterhaltungen im Status „Wartet auf Agent“ oder „Agent aktiv“</p>
          <div className="rv-insight-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(distributionPercent(handoffs, conversationCount))}
            aria-label="Anteil der Gespräche mit aktuellem Agentenbedarf">
            <div style={{ width: `${distributionPercent(handoffs, conversationCount)}%`, background: "#f1b65f" }} />
          </div>
        </WorkspacePanel>
        <WorkspacePanel title="Wissensabdeckung" description="Verfügbare Wissensquellen">
          <div className="rv-insight-number">{displayCount(data?.totalKnowledgeSources)}</div>
          <p className="rv-insight-description">
            Quellen mit {displayCount(data?.totalDocumentChunks)} durchsuchbaren Chunks
          </p>
          <p className="rv-insight-description">Anzahl vorhandener Quellen – kein automatisch ermittelter Qualitätswert.</p>
        </WorkspacePanel>
      </div>

      <div className="rv-section-grid rv-section-grid-two">
        <WorkspacePanel title="Unterhaltungsstatus" description="Verteilung der aktuellen Conversation-States">
          {states.length > 0 ? (
            <div className="rv-insight-bars">
              {states.map(([state, value]) => {
                const percent = distributionPercent(count(value), conversationCount);
                return (
                  <div className="rv-insight-bar" key={state}>
                    <div className="rv-insight-bar-label">
                      <span>{STATE_LABELS[state] ?? state.replaceAll("_", " ")}</span>
                      <strong>{displayCount(value)} · {Math.round(percent)}%</strong>
                    </div>
                    <div className="rv-insight-track">
                      <div style={{ width: `${percent}%`, background: STATE_TONES[state] ?? "#91a3c1" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <WorkspaceEmpty icon={Bot} title="Noch keine Unterhaltungen" description="Hier erscheinen die Statuswerte aus echten Kundengesprächen." />
          )}
        </WorkspacePanel>
        <WorkspacePanel title="Erkannte Sprachen" description="Verteilung nach Sprache der Unterhaltungen">
          {languages.length > 0 ? (
            <div className="rv-insight-bars">
              {languages.map((entry, index) => {
                const percent = distributionPercent(count(entry.count), languageCount);
                return (
                  <div className="rv-insight-bar" key={entry.language ?? "unknown"}>
                    <div className="rv-insight-bar-label">
                      <span>{entry.language?.toUpperCase() || "Unbekannt"}</span>
                      <strong>{displayCount(entry.count)} · {Math.round(percent)}%</strong>
                    </div>
                    <div className="rv-insight-track">
                      <div style={{ width: `${percent}%`, background: STATE_COLORS[index % STATE_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <WorkspaceEmpty icon={MessageSquare} title="Noch keine Sprachdaten" description="Sprachen erscheinen, sobald Gespräche entsprechend klassifiziert wurden." />
          )}
        </WorkspacePanel>
      </div>
    </div>
  );
}

export default memo(AnalyticsTab);
