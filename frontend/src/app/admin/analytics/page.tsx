"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BarChart3, BookOpenText, Search } from "lucide-react";
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

type Metrics = {
  range: { days: number; from: string; to: string };
  conversations: {
    total: number;
    resolved: number;
    waitingForAgent: number;
    agentActive: number;
    resolutionRate: number;
  };
  handoffs: { total: number; rate: number };
  tickets: { total: number; open: number; resolved: number };
  feedback: {
    positive: number;
    negative: number;
    satisfactionRate: number | null;
  };
  knowledgeGaps: { open: number; occurrences: number };
};

type KnowledgeGap = {
  id: string;
  topic: string;
  summary: string;
  status: string;
  occurrences: number;
  lastSeenAt: string;
};

type GapStatus = "open" | "acknowledged" | "resolved" | "ignored";

function percent(value: number | null) {
  return value === null ? "–" : Math.round(value * 100) + " %";
}

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "resolved") return "success";
  if (status === "open") return "warning";
  return "neutral";
}

function Stat({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: number | string;
  subtitle: string;
}) {
  return (
    <article className="min-w-0 space-y-3 rounded-2xl border border-[#e5eaf3] bg-white p-5 shadow-sm">
      <p className="text-sm text-[#667694]">{title}</p>
      <strong className="block text-3xl font-semibold tracking-tight text-[#172742]">
        {value}
      </strong>
      <p className="text-xs text-[#667694]">{subtitle}</p>
    </article>
  );
}

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [topic, setTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [processingGapId, setProcessingGapId] = useState<string | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [metricsResult, gapsResult] = await Promise.all([
        api.get("/analytics/support?days=" + days),
        api.get("/analytics/knowledge-gaps?limit=100"),
      ]);
      setMetrics(metricsResult.data);
      setGaps(gapsResult.data);
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error ||
          "Analytics konnten nicht geladen werden.",
      );
    } finally {
      setInitialLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createGap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/analytics/knowledge-gaps", {
        topic,
        summary,
        metadata: { source: "admin_manual" },
      });
      setTopic("");
      setSummary("");
      await load();
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error ||
          "Knowledge Gap konnte nicht gespeichert werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function discoverGaps() {
    setDiscovering(true);
    setError("");
    setDiscoveryMessage("");
    try {
      const { data } = await api.post("/analytics/knowledge-gaps/discover", {
        limit: 200,
      });
      setDiscoveryMessage(
        String(data.scanned ?? 0) +
          " negative Bewertungen geprüft, " +
          String(data.processed ?? 0) +
          " Knowledge-Gap-Signale verarbeitet.",
      );
      await load();
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error ||
          "Negatives Feedback konnte nicht analysiert werden.",
      );
    } finally {
      setDiscovering(false);
    }
  }

  async function setStatus(id: string, status: GapStatus) {
    setError("");
    setProcessingGapId(id);
    try {
      await api.patch("/analytics/knowledge-gaps/" + id, { status });
      await load();
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error ||
          "Knowledge Gap konnte nicht aktualisiert werden.",
      );
    } finally {
      setProcessingGapId(null);
    }
  }

  return (
    <AdminPage>
      <AdminHeader
        eyebrow="Auswertung / Support Operations"
        title="Analytics & Knowledge Gaps"
        description="Supportqualität, Eskalationen und fehlendes Wissen im Blick behalten."
        icon={BarChart3}
        actions={
          <>
            <AdminButton
              variant="secondary"
              disabled={discovering || loading}
              onClick={() => void discoverGaps()}
            >
              <Search size={16} aria-hidden="true" />
              {discovering ? "Analysiert…" : "Negatives Feedback analysieren"}
            </AdminButton>
            <label className="flex items-center gap-2 text-sm text-[#536584]">
              <span>Zeitraum</span>
              <select
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className={adminControlClassName}
                aria-label="Analytics-Zeitraum"
              >
                <option value={7}>7 Tage</option>
                <option value={30}>30 Tage</option>
                <option value={90}>90 Tage</option>
              </select>
            </label>
          </>
        }
      />
      {error && <AdminNotice tone="error">{error}</AdminNotice>}
      {discoveryMessage && (
        <AdminNotice tone="success">{discoveryMessage}</AdminNotice>
      )}

      {initialLoading && (
        <p role="status" className="text-sm text-[#667694]">
          Analytics werden geladen …
        </p>
      )}

      {metrics && (
        <section
          aria-label="Support-Kennzahlen"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
        >
          <Stat
            title="Conversations"
            value={metrics.conversations.total}
            subtitle={metrics.conversations.resolved + " gelöst"}
          />
          <Stat
            title="Resolution Rate"
            value={percent(metrics.conversations.resolutionRate)}
            subtitle="im Zeitraum"
          />
          <Stat
            title="Handoff Rate"
            value={percent(metrics.handoffs.rate)}
            subtitle={metrics.handoffs.total + " Übergaben"}
          />
          <Stat
            title="Offene Tickets"
            value={metrics.tickets.open}
            subtitle={metrics.tickets.resolved + " gelöst"}
          />
          <Stat
            title="Zufriedenheit"
            value={percent(metrics.feedback.satisfactionRate)}
            subtitle={
              metrics.feedback.positive +
              " positiv · " +
              metrics.feedback.negative +
              " negativ"
            }
          />
          <Stat
            title="Knowledge Gaps"
            value={metrics.knowledgeGaps.open}
            subtitle={metrics.knowledgeGaps.occurrences + " Vorkommen"}
          />
        </section>
      )}

      <AdminPanel
        title="Knowledge Gap erfassen"
        description="Nur das fehlende Wissensgebiet zusammenfassen. Personenbezogene Daten werden serverseitig nochmals redigiert."
      >
        <form
          onSubmit={createGap}
          className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end"
        >
          <label className="space-y-2 text-sm text-[#536584]">
            <span className="block font-medium">Thema</span>
            <input
              required
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="z. B. SSO-Einrichtung"
              className={adminControlClassName}
            />
          </label>
          <label className="space-y-2 text-sm text-[#536584]">
            <span className="block font-medium">Fehlende Information</span>
            <input
              required
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Welche Information fehlt?"
              className={adminControlClassName}
            />
          </label>
          <AdminButton type="submit" disabled={loading || discovering}>
            {loading ? "Speichert…" : "Erfassen"}
          </AdminButton>
        </form>
      </AdminPanel>

      <AdminPanel
        title="Knowledge Gaps"
        description="Erkannte Wissenslücken nach Häufigkeit sortiert."
      >
        {gaps.length === 0 ? (
          <AdminEmpty
            icon={BookOpenText}
            title="Noch keine Knowledge Gaps erfasst"
            description="Neue Lücken werden nach der Erkennung oder manuellen Erfassung hier angezeigt."
          />
        ) : (
          <div className="space-y-3">
            {gaps.map((gap) => (
              <article
                key={gap.id}
                className="rounded-xl border border-[#e5eaf3] bg-[#f8faff] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[#172742]">
                        {gap.topic}
                      </h3>
                      <AdminBadge tone={statusTone(gap.status)}>
                        {gap.status}
                      </AdminBadge>
                      <span className="text-xs text-[#667694]">
                        {gap.occurrences}×
                      </span>
                    </div>
                    <p className="text-sm text-[#536584]">{gap.summary}</p>
                    <p className="text-xs text-[#667694]">
                      Zuletzt gesehen:{" "}
                      {new Date(gap.lastSeenAt).toLocaleString("de-DE")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["acknowledged", "Bestätigen"],
                        ["resolved", "Gelöst"],
                        ["ignored", "Ignorieren"],
                        ["open", "Öffnen"],
                      ] as const
                    ).map(([status, label]) => (
                      <AdminButton
                        key={status}
                        variant="secondary"
                        disabled={processingGapId !== null}
                        onClick={() => void setStatus(gap.id, status)}
                      >
                        {label}
                      </AdminButton>
                    ))}
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
