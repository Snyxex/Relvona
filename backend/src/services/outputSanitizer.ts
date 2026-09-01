export class OutputSanitizer {
  // Escape dangerous HTML entities
  static escapeHtml(text: string): string {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Remove dangerous URL schemes (javascript:, data:, vbscript:)
  static sanitizeUrls(text: string): string {
    if (!text) return "";
    return text.replace(/href\s*=\s*["']?\s*(javascript|data|vbscript):[^"'\s>]+/gi, 'href="#"');
  }

  // Redact PII & Secret patterns from model response or logs
  static redactPIIAndSecrets(text: string): string {
    if (!text) return "";

    let result = text;

    // 1. Redact API Key & Token patterns (OpenAI, live keys, secret tokens)
    result = result.replace(/sk[-_][a-zA-Z0-9_-]{12,}/gi, "[REDACTED_API_KEY]");
    result = result.replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi, "[REDACTED_JWT]");

    // 2. Redact Raw Database Paths & Filesystem Paths
    result = result.replace(/([A-Z]:\\[^\s\n"']+)|(\/(var|usr|home|etc|tmp|app)\/[^\s\n"']+)/gi, "[redacted_path]");

    // 3. Redact Database UUIDs
    result = result.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]");

    // 4. Redact Credit Card-like 16-digit sequences
    result = result.replace(/\b(?:\d[ -]*?){13,16}\b/g, "[Redacted Number]");

    return result;
  }

  // Full Output Security Pipeline (Escaping + URL sanitization + PII Redaction)
  static sanitizeAIResponse(rawResponse: string): string {
    if (!rawResponse) return "";

    // 1. Redact secrets & system paths
    let clean = this.redactPIIAndSecrets(rawResponse);

    // 2. Sanitize dangerous script tags and inline event handlers
    clean = clean.replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "");
    clean = clean.replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");
    clean = this.sanitizeUrls(clean);

    return clean;
  }
}
