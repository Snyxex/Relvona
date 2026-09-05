import { metrics } from "../observability/metrics.js";

export type AIProvider = "openai" | "anthropic" | "google" | "nvidia" | "local";

export interface CompletionRequest {
  provider: AIProvider;
  model: string;
  /** Stable provider/tenant instructions, sent before request-specific context. */
  cachedSystemPrompt?: string;
  systemPrompt?: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  apiKey?: string | null;
  baseUrl?: string | null;
  temperature?: number;
  maxTokens?: number;
  /** Cache static instructions on providers that expose explicit prompt caching. */
  cacheSystemPrompt?: boolean;
  /** Receives provider tokens as they arrive. Supported by OpenAI-compatible providers. */
  onToken?: (token: string) => void | Promise<void>;
  retryAttempt?: number;
  /** Allows one explicitly configured fallback-model attempt while a provider circuit is open. */
  bypassCircuit?: boolean;
}

export interface EmbeddingRequest {
  provider: AIProvider;
  model?: string;
  texts: string[];
  apiKey?: string | null;
  baseUrl?: string | null;
}

export class UniversalAIGateway {
  private static readonly circuits = new Map<AIProvider, { failures: number; openUntil: number }>();
  private static readonly maxRetries = Number(process.env.AI_MAX_RETRIES || 2);
  private static readonly failureThreshold = 3;
  private static readonly cooldownMs = Number(process.env.AI_CIRCUIT_COOLDOWN_MS || 30_000);
  private static readonly timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS || 30_000);

  private static circuitFor(provider: AIProvider) { return this.circuits.get(provider) || { failures: 0, openUntil: 0 }; }
  private static transient(error: unknown) { return /\b(408|409|425|429|500|502|503|504)\b|fetch failed|network|timeout/i.test((error as Error).message || ""); }
  private static fetchWithTimeout(input: Parameters<typeof fetch>[0], init: RequestInit = {}) {
    return fetch(input, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  static async generateCompletion(req: CompletionRequest): Promise<string> {
    const provider = req.provider || "openai";
    const startedAt = performance.now();
    const circuit = this.circuitFor(provider);
    let emitted = false;
    const onToken = req.onToken ? async (token: string) => {
      emitted = true;
      await req.onToken!(token);
    } : undefined;
    if (!req.bypassCircuit && circuit.openUntil > Date.now()) throw new Error(`LLM provider '${provider}' circuit is open`);
    try {
      const answer = await this.generateCompletionOnce({ ...req, onToken });
      this.circuits.set(provider, { failures: 0, openUntil: 0 });
      metrics.increment("supportai_ai_requests_total", { provider, status: "success", streaming: Boolean(req.onToken) });
      metrics.observe("supportai_ai_request_duration_seconds", performance.now() - startedAt, { provider, streaming: Boolean(req.onToken) });
      return answer;
    } catch (error) {
      const failures = circuit.failures + 1;
      metrics.increment("supportai_ai_requests_total", { provider, status: "error", streaming: Boolean(req.onToken) });
      this.circuits.set(provider, { failures, openUntil: failures >= this.failureThreshold ? Date.now() + this.cooldownMs : 0 });
      const attempt = req.retryAttempt || 0;
      if (!emitted && attempt < this.maxRetries && this.transient(error)) {
        const backoff = 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoff + Math.floor(Math.random() * Math.max(1, backoff * 0.25))));
        return this.generateCompletion({ ...req, retryAttempt: attempt + 1 });
      }
      throw error;
    }
  }

  private static async readOpenAiCompatibleStream(response: Response, onToken: NonNullable<CompletionRequest["onToken"]>): Promise<string> {
    if (!response.body) throw new Error("Provider returned an empty streaming response");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let finished = false;
    try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") { finished = true; continue; }
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          // Providers may send comments or non-token events in the SSE stream.
          continue;
        }
        if (event.error) throw new Error("Provider streaming response failed");
        if (event.choices?.[0]?.finish_reason) finished = true;
        const token = event.choices?.[0]?.delta?.content;
        if (typeof token === "string" && token) {
          answer += token;
          await onToken(token);
        }
      }
      if (done) break;
    }
    if (!finished) throw new Error("Provider stream ended before completion");
    return answer;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  // ----------------------------------------------------
  // 1. UNIVERSAL CHAT COMPLETION
  // ----------------------------------------------------
  private static async generateCompletionOnce(req: CompletionRequest): Promise<string> {
    const provider = req.provider || "openai";
    const temperature = req.temperature ?? 0.2;
    const maxTokens = req.maxTokens || 1024;

    try {
      // --- PROVIDER 1: OPENAI ---
      if (provider === "openai") {
        const apiKey = req.apiKey || process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OpenAI API Key is missing");

        const endpoint = req.baseUrl ? `${req.baseUrl.replace(/\/$/, "")}/chat/completions` : "https://api.openai.com/v1/chat/completions";

        const formattedMessages = [];
        if (req.cachedSystemPrompt) {
          formattedMessages.push({ role: "system", content: req.cachedSystemPrompt });
        }
        if (req.systemPrompt) {
          formattedMessages.push({ role: "system", content: req.systemPrompt });
        }
        formattedMessages.push(...req.messages);

        const response = await this.fetchWithTimeout(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: req.model || "gpt-4o-mini",
            messages: formattedMessages,
            temperature,
            max_tokens: maxTokens,
            stream: Boolean(req.onToken),
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenAI API error (${response.status}): ${errText}`);
        }

        if (req.onToken) return this.readOpenAiCompatibleStream(response, req.onToken);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
      }

      // --- PROVIDER 2: ANTHROPIC CLAUDE ---
      if (provider === "anthropic") {
        const apiKey = req.apiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("Anthropic API Key is missing");

        const endpoint = req.baseUrl ? `${req.baseUrl.replace(/\/$/, "")}/v1/messages` : "https://api.anthropic.com/v1/messages";

        const formattedMessages = req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          }));

        const system = [
          ...(req.cachedSystemPrompt
            ? [{ type: "text", text: req.cachedSystemPrompt, ...(req.cacheSystemPrompt ? { cache_control: { type: "ephemeral" } } : {}) }]
            : []),
          ...(req.systemPrompt ? [{ type: "text", text: req.systemPrompt }] : []),
        ];

        const response = await this.fetchWithTimeout(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: req.model || "claude-3-5-sonnet-20241022",
            system: system.length ? system : undefined,
            messages: formattedMessages,
            max_tokens: maxTokens,
            temperature,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Anthropic API error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const answer = data.content?.[0]?.text || "";
        if (req.onToken && answer) await req.onToken(answer);
        return answer;
      }

      // --- PROVIDER 3: GOOGLE GEMINI ---
      if (provider === "google") {
        const apiKey = req.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("Google Gemini API Key is missing");

        const modelName = req.model || "gemini-1.5-flash";
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        const contents = [];
        if (req.systemPrompt) {
          contents.push({ role: "user", parts: [{ text: `System Instruction: ${req.systemPrompt}` }] });
          contents.push({ role: "model", parts: [{ text: "Understood. I will strictly follow these instructions." }] });
        }

        req.messages.forEach((m) => {
          contents.push({
            role: m.role === "user" ? "user" : "model",
            parts: [{ text: m.content }],
          });
        });

        const response = await this.fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature, maxOutputTokens: maxTokens },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Google Gemini API error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (req.onToken && answer) await req.onToken(answer);
        return answer;
      }

      // --- PROVIDER 4: NVIDIA NIM ---
      if (provider === "nvidia") {
        const apiKey = req.apiKey || process.env.NVIDIA_API_KEY;
        if (!apiKey) throw new Error("NVIDIA API Key is missing");

        const endpoint = req.baseUrl ? `${req.baseUrl.replace(/\/$/, "")}/chat/completions` : "https://integrate.api.nvidia.com/v1/chat/completions";

        const formattedMessages = [];
        if (req.systemPrompt) {
          formattedMessages.push({ role: "system", content: req.systemPrompt });
        }
        formattedMessages.push(...req.messages);

        const response = await this.fetchWithTimeout(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: req.model || "nvidia/llama-3.1-8b-instruct",
            messages: formattedMessages,
            temperature,
            max_tokens: maxTokens,
            stream: Boolean(req.onToken),
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`NVIDIA API error (${response.status}): ${errText}`);
        }

        if (req.onToken) return this.readOpenAiCompatibleStream(response, req.onToken);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
      }

      // --- PROVIDER 5: LOCAL / OLLAMA / LOCALAI ---
      if (provider === "local") {
        const baseUrl = req.baseUrl || process.env.LOCAL_AI_BASE_URL || "http://localhost:11434/v1";
        const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

        const formattedMessages = [];
        if (req.systemPrompt) {
          formattedMessages.push({ role: "system", content: req.systemPrompt });
        }
        formattedMessages.push(...req.messages);

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (req.apiKey) {
          headers["Authorization"] = `Bearer ${req.apiKey}`;
        }

        const response = await this.fetchWithTimeout(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: req.model || "llama3",
            messages: formattedMessages,
            temperature,
            max_tokens: maxTokens,
            stream: Boolean(req.onToken),
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Local AI API error (${response.status}): ${errText}`);
        }

        if (req.onToken) return this.readOpenAiCompatibleStream(response, req.onToken);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
      }

      throw new Error(`Unsupported AI Provider: ${provider}`);
    } catch (error) {
      console.warn(JSON.stringify({ level: "warn", event: "ai.completion_failed", provider, error: (error as Error).message }));
      throw error;
    }
  }

  // ----------------------------------------------------
  // 2. UNIVERSAL EMBEDDING GENERATION
  // ----------------------------------------------------
  static async generateEmbeddings(req: EmbeddingRequest): Promise<number[][]> {
    const provider = req.provider || "openai";

    try {
      if (provider === "openai") {
        const apiKey = req.apiKey || process.env.OPENAI_API_KEY;
        if (apiKey) {
          const endpoint = req.baseUrl ? `${req.baseUrl.replace(/\/$/, "")}/embeddings` : "https://api.openai.com/v1/embeddings";
          const res = await this.fetchWithTimeout(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: req.model || "text-embedding-3-small",
              input: req.texts,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            return data.data.map((item: any) => item.embedding);
          }
        }
      }

      if (provider === "local" && req.baseUrl) {
        const endpoint = `${req.baseUrl.replace(/\/$/, "")}/embeddings`;
        const res = await this.fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: req.model || "nomic-embed-text",
            input: req.texts,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          return data.data.map((item: any) => item.embedding);
        }
      }
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", event: "ai.embedding_failed", provider, error: (err as Error).message }));
    }

    throw new Error(`Embedding provider '${provider}' is unavailable`);
  }
}
