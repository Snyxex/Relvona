# Answer quality preview (experimental)

Relvona includes a **manual, read-only heuristic preview** for support answer drafts. It complements the existing knowledge health, retrieval history, gap tracking, and FAQ approval workflows. It does not change live model output or automatically publish, block, or approve any customer-facing reply.

## Endpoint

`POST /api/v1/knowledge-intelligence/answer-quality/preview` (under the existing knowledge-intelligence router mount).

Requires a signed-in organization owner, administrator, or agent and the normal tenant middleware. Example body:

```json
{
  "answer": "Our support team can review this request. [source:123e4567-e89b-42d3-a456-426614174000]",
  "evidenceIds": ["123e4567-e89b-42d3-a456-426614174000"]
}
```

Source markers use the exact format `[source:ID]`, where IDs are source UUIDs. All supplied evidence IDs are looked up by UUID within the authenticated organization; a missing or foreign source produces HTTP 404 without disclosing whether it exists elsewhere. This verifies source ownership, **not** that the source supports the answer.

Limits: at most 12,000 characters per answer, 30 unique evidence UUIDs. Invalid shapes are rejected with HTTP 400. The result contains issue codes and counts, not excerpts of the supplied text; the handler does not persist the draft. HTTP responses are marked `Cache-Control: no-store`. Existing reverse-proxy logging and request tracing policies must still be reviewed before using sensitive content.

## Response and interpretation

The result includes `decision`, `issues`, `evidenceCount`, `citationCount`, and `disclaimer`. Possible issue codes:

| Code | Interpretation |
| --- | --- |
| `EMPTY_ANSWER` | No visible answer text |
| `NO_EVIDENCE` | Caller supplied no evidence reference IDs |
| `MISSING_CITATION` | No recognized source markers in the answer |
| `UNKNOWN_CITATION` | An answer marker is not among the caller-supplied IDs |
| `UNCITED_PARAGRAPH` | A paragraph of substantial length has no recognized source marker |
| `POSSIBLE_SECRET` | A small set of high-signal secret formats was detected |
| `POSSIBLE_PERSONAL_DATA` | Email-shaped text was detected |

`needs_review` means at least one heuristic flag is present. `no_heuristic_flags` **never** means verified, correct, safe, or ready to publish. It is not a confidence score.

## Intended use

1. An agent drafts a response using approved organization knowledge.
2. The calling UI or tool supplies the answer and references it already has permission to access.
3. The agent inspects warnings, opens source records in the existing knowledge interface, and checks whether individual claims are actually supported.
4. The agent edits the draft or escalates. Final send/publish remains a separate, authorized action.

The current endpoint checks knowledge source ownership but does **not** retrieve or assess their content and does not provide semantic faithfulness evaluation. Future phases may add verified tenant-scoped evidence resolution, semantic comparison with citations, multilingual quality benchmarks, false-positive measurement, and an explicit administrator review queue. None of these are claimed as implemented.

## Security and verification

No new schema, migration, cron job, background worker, model provider, or external network connection is added. The route retains existing authentication, tenant context, and role requirements. It never returns or logs submitted answer text in its own implementation.

Before using this feature in production, run TypeScript/build checks, negative authorization checks, body-limit and malformed-input tests, tenant-boundary tests when source resolution is introduced, and independent review of how sensitive payloads are handled by application/proxy telemetry. No such tests were run while CI was unavailable.
