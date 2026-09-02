export type PiiKind = "credit_card" | "password" | "email" | "phone" | "api_key" | "jwt";

function luhn(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let index = digits.length - 1, parity = 0; index >= 0; index--, parity ^= 1) {
    let digit = Number(digits[index]);
    if (parity) digit *= 2;
    sum += digit > 9 ? digit - 9 : digit;
  }
  return sum % 10 === 0;
}

/** Removes accidental sensitive data before it is persisted, logged, embedded, or sent to an LLM. */
export class PiiRedactionService {
  static redact(text: string) {
    const detected = new Set<PiiKind>();
    let value = text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (candidate) => {
      if (!luhn(candidate)) return candidate;
      detected.add("credit_card");
      return "[REDACTED_CREDIT_CARD]";
    });
    value = value.replace(/\b(password|passwort|pwd|secret)\s*[:=]\s*([^\s,;]+)/gi, (_match, label) => {
      detected.add("password");
      return `${label}: [REDACTED_PASSWORD]`;
    });
    value = value.replace(/\bsk[-_][a-zA-Z0-9_-]{12,}\b/g, () => { detected.add("api_key"); return "[REDACTED_API_KEY]"; });
    value = value.replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, () => { detected.add("jwt"); return "[REDACTED_JWT]"; });
    value = value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => { detected.add("email"); return "[REDACTED_EMAIL]"; });
    value = value.replace(/(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g, () => { detected.add("phone"); return "[REDACTED_PHONE]"; });
    return { text: value, detected: [...detected] };
  }
}
