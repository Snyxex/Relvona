"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type KnowledgeSource = { id: string; title: string };
type Issue = {
  code: string;
  severity: "warning" | "critical";
  paragraph?: number;
};
type Preview = {
  decision: string;
  evidenceCount: number;
  citationCount: number;
  issues: Issue[];
  disclaimer: string;
};

const issueLabels: Record<string, string> = {
  EMPTY_ANSWER: "Antwort ist leer",
  NO_EVIDENCE: "Keine Quellen ausgewählt",
  MISSING_CITATION: "Quellenverweise fehlen",
  UNKNOWN_CITATION: "Unbekannter Quellenverweis",
  UNCITED_PARAGRAPH: "Absatz ohne Quellenverweis",
  POSSIBLE_SECRET: "Möglicher geheimer Schlüssel",
  POSSIBLE_PERSONAL_DATA: "Mögliche personenbezogene Daten",
};

export default function AnswerQualityPage() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api
      .get("/knowledge-intelligence/sources", { params: { limit: 100 } })
      .then(({ data }) => {
        if (active) setSources(data.items || []);
      })
      .catch(() => {
        if (active) setError("Wissensquellen konnten nicht geladen werden.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function inspect() {
    setChecking(true);
    setError("");
    setPreview(null);
    try {
      const { data } = await api.post(
        "/knowledge-intelligence/answer-quality/preview",
        {
          answer,
          evidenceIds: selected,
        },
      );
      setPreview(data);
    } catch (caught: unknown) {
      const errorResponse = caught as {
        response?: { data?: { error?: string } };
      };
      setError(
        errorResponse.response?.data?.error ||
          "Die Antwort konnte nicht geprüft werden.",
      );
    } finally {
      setChecking(false);
    }
  }

  function toggleSource(id: string) {
    setSelected((old) =>
      old.includes(id)
        ? old.filter((item) => item !== id)
        : old.length < 30
          ? [...old, id]
          : old,
    );
    setPreview(null);
  }

  const resultTitle = preview?.issues.length
    ? "Manuelle Prüfung erforderlich"
    : "Keine heuristischen Auffälligkeiten";

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Antwortqualität prüfen</h1>
        <p className="mt-2 text-sm text-slate-500">
          Manuelle Vorschau für Antwortentwürfe. Keine automatische
          Veröffentlichung und keine inhaltliche Wahrheitsprüfung.
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-slate-300 p-5">
        <label
          className="block text-sm font-medium"
          htmlFor="answer-review-draft"
        >
          Antwortentwurf
        </label>
        <textarea
          id="answer-review-draft"
          className="min-h-40 w-full rounded border border-slate-400 p-3 text-slate-900"
          maxLength={12000}
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value);
            setPreview(null);
          }}
          placeholder="Antwort mit Quellenangaben wie [source:123e4567-e89b-42d3-a456-426614174000] eingeben"
        />
        <p className="text-xs text-slate-500">{answer.length}/12000 Zeichen</p>

        <fieldset className="space-y-2">
          <legend className="font-medium">
            Quellen der Organisation auswählen (maximal 30)
          </legend>
          {loading && <p>Quellen werden geladen.</p>}
          {!loading && sources.length === 0 && (
            <p className="text-sm">Keine verfügbaren Quellen.</p>
          )}
          <div className="max-h-64 space-y-2 overflow-auto rounded border border-slate-300 p-3">
            {sources.map((source) => (
              <label key={source.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(source.id)}
                  disabled={
                    !selected.includes(source.id) && selected.length >= 30
                  }
                  onChange={() => toggleSource(source.id)}
                />
                <span>
                  {source.title}{" "}
                  <code className="block break-all text-xs text-slate-500">
                    {source.id}
                  </code>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          disabled={checking || loading || answer.length > 12000}
          onClick={() => void inspect()}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {checking ? "Prüfe…" : "Qualitätsvorschau starten"}
        </button>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded border border-red-600 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      {preview && (
        <section
          aria-live="polite"
          className="space-y-3 rounded-xl border border-slate-300 p-5"
        >
          <h2 className="text-lg font-semibold">Ergebnis: {resultTitle}</h2>
          <p className="text-sm">
            {preview.evidenceCount} referenzierte Quellen · {preview.citationCount}{" "}
            Quellenmarker · {preview.issues.length} Hinweise
          </p>
          <ul className="list-disc space-y-2 pl-5">
            {preview.issues.map((issue) => (
              <li
                key={`${issue.code}:${issue.paragraph ?? "global"}`}
                className="text-sm"
              >
                <strong>
                  {issue.severity === "critical" ? "Kritisch" : "Hinweis"}:
                </strong>{" "}
                {issueLabels[issue.code] || issue.code}
                {issue.paragraph ? ` (Absatz ${issue.paragraph})` : ""}
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-500">
            Das Ergebnis prüft weder die sachliche Richtigkeit noch, ob einzelne
            Aussagen von den Quellen gedeckt sind. Vor dem Versenden müssen
            Quellen und Antwort manuell geprüft werden.
          </p>
        </section>
      )}
    </main>
  );
}
