# Privacy & Data Retention Architecture

## Personal Data Handling & Minimization

The AI Customer Support Platform is designed with privacy-by-default principles:

1. **Data Minimization**: Only customer name, email (or anonymous visitor ID), and support message transcripts are stored.
2. **PII Redaction**: Model responses and logging channels pass through `OutputSanitizer.redactPIIAndSecrets()` to strip accidental credit cards, JWT tokens, API keys, and internal database paths.
3. **Tenant Data Isolation**: Database relationships cascade delete dependent records (`conversations`, `messages`, `tickets`, `knowledge_sources`, `document_chunks`) when an organization or customer is deleted.
4. **Third-Party AI Processor Isolation**: Customer data is sent to configured AI provider endpoints (OpenAI, Anthropic, Gemini, NVIDIA, or Local) strictly for real-time inference. Organization credentials are encrypted at rest using AES-256-GCM.
