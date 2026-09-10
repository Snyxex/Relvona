const ROLE_PREFIX = /^(?:system|developer|assistant|tool|function)\s*:/gim;
const INSTRUCTION_PHRASES = [
  /ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|above|prior)\s+instructions?/gi,
  /disregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|above|prior)\s+instructions?/gi,
  /(?:reveal|show|print|return)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message|instructions?)/gi,
  /you\s+are\s+now\s+/gi,
  /act\s+as\s+(?:a|an)\s+/gi,
];

export function sanitizeUntrustedHistoricalContext(value: unknown, maxLength = 1_500): string {
  if (typeof value !== "string") return "";
  let text = value
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(ROLE_PREFIX, "[untrusted-role-label]:");

  for (const pattern of INSTRUCTION_PHRASES) {
    text = text.replace(pattern, "[untrusted-instruction-removed]");
  }

  // Prevent historical text from closing our own trust-boundary markers.
  text = text.replace(/<\/?UNTRUSTED_[A-Z0-9_-]+(?:\s[^>]*)?>/gi, "[untrusted-marker-removed]");
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, Math.max(0, maxLength));
}

export function wrapUntrustedHistoricalContext(kind: "conversation_summary" | "visitor_memory", value: unknown, maxLength: number): string | undefined {
  const sanitized = sanitizeUntrustedHistoricalContext(value, maxLength);
  if (!sanitized) return undefined;
  return `<UNTRUSTED_PRIOR_CONTEXT kind="${kind}">\n${sanitized}\n</UNTRUSTED_PRIOR_CONTEXT>`;
}
