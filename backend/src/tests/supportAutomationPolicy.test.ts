import assert from "node:assert/strict";
import { automationEventKey, parseAutomationRule, ruleMatches } from "../services/supportAutomationPolicy.js";

const rule = parseAutomationRule({
  name: "Urgent support", description: "Route urgent tickets", enabled: false, trigger: "ticket.created",
  conditions: { priorities: ["urgent"], statuses: ["open"], onlyUnassigned: true,
    tagsAny: ["Billing", "support"], subjectIncludes: "payment" },
  actions: [{ type: "set_priority", priority: "high" }, { type: "notify_admins", message: "Urgent request" }],
});
assert.equal(rule.enabled, false);
assert.deepEqual(rule.conditions.tagsAny, ["billing", "support"]);
assert.equal(ruleMatches(rule.conditions, {
  priority: "urgent", status: "open", assignedAgentId: null, tags: ["BILLING"], subject: "Payment failed",
}), true);
assert.equal(ruleMatches(rule.conditions, {
  priority: "normal", status: "open", assignedAgentId: null, tags: ["BILLING"], subject: "Payment failed",
}), false);
assert.equal(ruleMatches(rule.conditions, {
  priority: "urgent", status: "open", assignedAgentId: "user-id", tags: ["billing"], subject: "Payment failed",
}), false);

assert.throws(() => parseAutomationRule({ ...rule, conditions: { code: "eval" } }), /Unknown condition/);
assert.throws(() => parseAutomationRule({ ...rule, trigger: "system.command" }), /Invalid rule trigger/);
assert.throws(() => parseAutomationRule({ ...rule, actions: [{ type: "webhook", url: "https://evil.test" }] }), /Invalid automation action/);
assert.throws(() => parseAutomationRule({ ...rule, actions: [{ type: "add_tag", tag: "a" }, { type: "add_tag", tag: "b" }] }), /Duplicate action/);
assert.throws(() => parseAutomationRule({ ...rule, enabled: "yes" }), /Invalid enabled state/);
assert.throws(() => parseAutomationRule({ ...rule, trigger: "ticket.idle", idleMinutes: 0 }), /Invalid idle threshold/);
assert.equal(automationEventKey("ticket.created","abc",new Date("2026-10-27T10:00:00.000Z")),
  automationEventKey("ticket.created","abc",new Date("2026-10-27T11:00:00.000Z")));
console.log("Support automation policy tests passed");
