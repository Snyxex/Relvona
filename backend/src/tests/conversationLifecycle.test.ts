import assert from "node:assert/strict";
import { canTransition } from "../services/conversationWorkflowService.js";

const valid: Array<[string, string]> = [
  ["AI_ACTIVE", "NEEDS_HUMAN"], ["NEEDS_HUMAN", "WAITING_FOR_AGENT"],
  ["WAITING_FOR_AGENT", "AGENT_ACTIVE"], ["AGENT_ACTIVE", "WAITING_FOR_CUSTOMER"],
  ["WAITING_FOR_CUSTOMER", "AGENT_ACTIVE"], ["AGENT_ACTIVE", "RESOLVED"], ["RESOLVED", "CLOSED"],
];
for (const [from, to] of valid) assert.equal(canTransition(from, to), true, `${from} -> ${to} must be valid`);
assert.equal(canTransition("AI_ACTIVE", "RESOLVED"), false, "AI cannot resolve a conversation directly");
assert.equal(canTransition("WAITING_FOR_CUSTOMER", "CLOSED"), true, "staff may close a waiting conversation");
assert.equal(canTransition("CLOSED", "WAITING_FOR_AGENT"), false, "agents cannot reopen a closed conversation");
assert.equal(canTransition("CLOSED", "WAITING_FOR_AGENT", "customer"), true, "a verified customer reply reopens a closed conversation");
assert.equal(canTransition("RESOLVED", "WAITING_FOR_AGENT"), false, "resolved conversations reopen into active agent work only");
console.log("Conversation lifecycle transition tests passed.");
