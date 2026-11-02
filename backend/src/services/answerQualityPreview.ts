/**
 * Conservative, deterministic checks for manually submitted support answer drafts.
 * No model inference, database writes, or external requests are performed.
 * The result is a review aid, not proof of factual correctness.
 */
export type AnswerQualityIssueCode =
  | "EMPTY_ANSWER"
  | "NO_EVIDENCE"
  | "MISSING_CITATION"
  | "UNKNOWN_CITATION"
  | "UNCITED_PARAGRAPH"
  | "POSSIBLE_SECRET"
  | "POSSIBLE_PERSONAL_DATA";

export interface AnswerQualityIssue {
  code: AnswerQualityIssueCode;
  severity: "warning" | "critical";
  paragraph?: number;
}

export interface AnswerQualityPreview {
  decision: "needs_review" | "no_heuristic_flags";
  issues: AnswerQualityIssue[];
  evidenceCount: number;
  citationCount: number;
  disclaimer: string;
}

const CITATION = /\\[source:([a-zA-Z0-9_-]{1,80})\\]/g;
const CLAIM_LENGTH = 45;
const DISCLAIMER = "Heuristic review only. No factual entailment, authorization, source trust, or compliance guarantee. A human must inspect the source and answer.";

export function inspectAnswerQuality(input: {
  answer: string;
  evidenceIds: readonly string[];
}): AnswerQualityPreview {
  const issues: AnswerQualityIssue[] = [];
  const answer = input.answer.trim();
  const evidence = new Set(input.evidenceIds);
  const citations = [...answer.matchAll(CITATION)].map((match) => match[1]);

  if (!answer) issues.push({ code: "EMPTY_ANSWER", severity: "critical" });
  if (evidence.size === 0) issues.push({ code: "NO_EVIDENCE", severity: "warning" });
  if (answer && citations.length === 0) issues.push({ code: "MISSING_CITATION", severity: "warning" });
  if (citations.some((id) => !evidence.has(id))) issues.push({ code: "UNKNOWN_CITATION", severity: "critical" });

  // Long text paragraphs without a source marker are flagged for human review.
  // This is deliberately a weak syntactic indicator, not a factuality classifier.
  answer.split(/\\n\\s*\\n/).forEach((paragraph, index) => {
    if (paragraph.replace(CITATION, "").trim().length >= CLAIM_LENGTH && !paragraph.match(CITATION)) {
      issues.push({ code: "UNCITED_PARAGRAPH", severity: "warning", paragraph: index + 1 });
    }
  });

  // Only detect strongly structured examples; never echo matched values into issues/logs.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\\b(?:sk-proj-|sk_live_|ghp_)[A-Za-z0-9_-]{12,}/i.test(answer)) {
    issues.push({ code: "POSSIBLE_SECRET", severity: "critical" });
  }
  if (/\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i.test(answer)) {
    issues.push({ code: "POSSIBLE_PERSONAL_DATA", severity: "warning" });
  }

  return {
    decision: issues.length ? "needs_review" : "no_heuristic_flags",
    issues,
    evidenceCount: evidence.size,
    citationCount: citations.length,
    disclaimer: DISCLAIMER,
  };
}
