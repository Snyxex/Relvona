import assert from "node:assert/strict";
import { UniversalAIGateway } from "../services/aiGateway.js";

const originalFetch = globalThis.fetch;
let requests = 0;
const request = { provider: "openai" as const, model: "test", apiKey: "test-only", messages: [{ role: "user" as const, content: "test" }] };
async function main() {
try {
  globalThis.fetch = async () => {
    requests++;
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  };
  const tokens: string[] = [];
  assert.equal(await UniversalAIGateway.generateCompletion({ ...request, onToken: (token) => { tokens.push(token); } }), "hello");
  assert.deepEqual(tokens, ["hello"]);
  requests = 0;
  await assert.rejects(UniversalAIGateway.generateCompletion({ ...request, onToken: () => { throw new Error("timeout in output consumer"); } }), /timeout in output consumer/);
  assert.equal(requests, 1, "A consumer failure after output must propagate without retrying");
  requests = 0;
  globalThis.fetch = async () => {
    requests++;
    let reads = 0;
    return new Response(new ReadableStream({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      else controller.error(new Error("network timeout"));
    } }));
  };
  await assert.rejects(UniversalAIGateway.generateCompletion({ ...request, onToken: () => {} }), /network timeout/);
  assert.equal(requests, 1, "Partial streaming output must not be duplicated by a retry");
  console.log("Streaming regression tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
