import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const scriptPath = path.resolve("src/scripts/ensureKnowledgeRetrievalTracking.ts");
const source = fs.readFileSync(scriptPath, "utf8");

assert.match(source, /SECURITY INVOKER/, "retrieval trigger must execute with caller privileges");
assert.match(source, /NEW\.sender_type <> 'ai'/, "retrieval tracking must ignore non-AI messages");
assert.match(source, /SELECT DISTINCT NEW\.organization_id, NEW\.conversation_id, dc\.source_id, dc\.id/, "retrieval events must deduplicate chunk ids");
assert.match(source, /count\(DISTINCT dc\.id\)/, "source retrieval counters must deduplicate chunk ids");
assert.match(source, /dc\.organization_id = NEW\.organization_id/, "chunk attribution must remain tenant scoped");

console.log("Knowledge retrieval trigger shape test passed.");
