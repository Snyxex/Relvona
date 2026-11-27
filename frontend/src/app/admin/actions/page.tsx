"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import {
  AdminBadge,
  AdminButton,
  AdminEmpty,
  AdminHeader,
  AdminNotice,
  AdminPage,
  AdminPanel,
} from "@/components/admin/admin-ui";
import { api } from "@/lib/api";

type Execution = {
  id: string;
  toolId: string;
  status: string;
  riskLevel: string;
  input: Record<string, unknown>;
  createdAt: string;
  decisionReason?: string | null;
  error?: string | null;
};

function statusTone(status: string) {
  if (status === "pending") return "warning" as const;
  if (
    status === "approved" ||
    status === "completed" ||
    status === "succeeded"
  ) {
    return "success" as const;
  }
  if (status === "rejected" || status === "failed") return "danger" as const;
  return "neutral" as const;
}

export default function AdminActionsPage() {
  const [rows, setRows] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/tools/executions");
      setRows(data);
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error ||
          "AI Actions konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: "approve" | "reject") {
    setError("");
    setProcessingId(id);
    try {
      await api.post("/tools/executions/" + id + "/" + action, {});
      await load();
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error ||
          "Aktion konnte nicht verarbeitet werden.",
      );
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <AdminPage>
      <AdminHeader
        eyebrow="KI & Wissen / Automation"
        title="AI Actions"
        description="Prüfe schreibende KI-Aktionen und entscheide vor der Ausführung über die Freigabe."
        icon={ClipboardCheck}
        actions={
          <AdminButton
            variant="secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Aktualisieren
          </AdminButton>
        }
      />
      {error && <AdminNotice tone="error">{error}</AdminNotice>}
      {loading ? (
        <AdminPanel>
          <p role="status" className="text-sm text-[#667694]">
            AI Actions werden geladen …
          </p>
        </AdminPanel>
      ) : rows.length === 0 ? (
        <AdminPanel>
          <AdminEmpty
            icon={ClipboardCheck}
            title="Keine AI Actions vorhanden"
            description="Sobald eine Aktion eine manuelle Freigabe benötigt, erscheint sie hier."
          />
        </AdminPanel>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <AdminPanel key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h2 className="break-all font-semibold text-[#172742]">
                    {row.toolId}
                  </h2>
                  <p className="text-xs text-[#667694]">
                    {new Date(row.createdAt).toLocaleString("de-DE")} · Risiko:{" "}
                    {row.riskLevel}
                  </p>
                </div>
                <AdminBadge tone={statusTone(row.status)}>
                  {row.status}
                </AdminBadge>
              </div>
              <pre className="max-h-72 overflow-auto rounded-xl border border-[#e5eaf3] bg-[#f8faff] p-4 text-xs text-[#263954]">
                {JSON.stringify(row.input, null, 2)}
              </pre>
              {row.error && <AdminNotice tone="error">{row.error}</AdminNotice>}
              {row.decisionReason && (
                <p className="text-sm text-[#667694]">
                  Begründung: {row.decisionReason}
                </p>
              )}
              {row.status === "pending" && (
                <div className="flex flex-wrap gap-3 border-t border-[#edf0f6] pt-4">
                  <AdminButton
                    disabled={processingId !== null}
                    onClick={() => void decide(row.id, "approve")}
                  >
                    {processingId === row.id
                      ? "Verarbeite …"
                      : "Freigeben & ausführen"}
                  </AdminButton>
                  <AdminButton
                    variant="danger"
                    disabled={processingId !== null}
                    onClick={() => void decide(row.id, "reject")}
                  >
                    Ablehnen
                  </AdminButton>
                </div>
              )}
            </AdminPanel>
          ))}
        </div>
      )}
    </AdminPage>
  );
}
