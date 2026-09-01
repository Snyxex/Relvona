# AI Security Architecture & OWASP GenAI Matrix

## Supported AI Providers & Universal Gateway

The platform routes all completion and embedding operations through a unified **Universal AI Gateway** ([`aiGateway.ts`](file:///B:/Devion_Repos/AI_Customer_Sup/backend/src/services/aiGateway.ts)):

1. **OpenAI**: `gpt-4o`, `gpt-4o-mini`, `o3-mini` (`text-embedding-3-small`)
2. **Anthropic**: `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`, `claude-3-opus-20240229`
3. **Google Gemini**: `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`
4. **NVIDIA NIM**: `nvidia/llama-3.1-8b-instruct`
5. **Local / Ollama**: Custom OpenAI-compatible endpoints (`http://localhost:11434/v1`)

---

## AI Trust Model & Safeguards

- **Zero LLM Authority**: The LLM cannot perform database updates, user role changes, ticket deletions, or organization configuration edits.
- **Human Approval for Handoffs & Replies**: AI suggested replies for support agents must be explicitly reviewed and sent by the human agent.
- **Hallucination & Low-Confidence Guardrails**: When knowledge search similarity drops below 0.25, the system automatically offers human escalation instead of inventing answers.
- **Prompt Injection Defense**: Dual-layer defense combining XML tag wrapping (`<retrieved_knowledge_untrusted>`), instruction-data separation, and output regex sanitization.
