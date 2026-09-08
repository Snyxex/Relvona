import { toolRegistry } from "../services/toolRegistry.js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const schedulingToolIds = [
  "scheduling.find_available_slots",
  "scheduling.list_bookings",
  "scheduling.create_booking",
  "scheduling.reschedule_booking",
  "scheduling.cancel_booking",
];

const supportTool = toolRegistry.get("support.get_ticket_case");
assert(Boolean(supportTool), "Support ticket case tool must be registered");
assert(supportTool?.riskLevel === "read", "Ticket case lookup must remain read-only");
assert(supportTool?.requiresApproval === false, "Ticket case lookup must not require approval");

const agentSchedulingTools = toolRegistry.getAvailableTools({ actorRole: "agent" }, schedulingToolIds);
assert(agentSchedulingTools.length === schedulingToolIds.length, "Agents must see all configured scheduling tools");

for (const toolId of ["scheduling.find_available_slots", "scheduling.list_bookings"]) {
  const tool = agentSchedulingTools.find((candidate) => candidate.id === toolId);
  assert(Boolean(tool), `${toolId} must be registered`);
  assert(tool?.riskLevel === "read", `${toolId} must remain read-only`);
  assert(tool?.requiresApproval === false, `${toolId} must not require approval`);
}

for (const toolId of ["scheduling.create_booking", "scheduling.reschedule_booking", "scheduling.cancel_booking"]) {
  const tool = agentSchedulingTools.find((candidate) => candidate.id === toolId);
  assert(Boolean(tool), `${toolId} must be registered`);
  assert(tool?.riskLevel === "write", `${toolId} must remain a write action`);
  assert(tool?.requiresApproval === true, `${toolId} must require explicit approval`);
}

const viewerSchedulingTools = toolRegistry.getAvailableTools({ actorRole: "viewer" }, schedulingToolIds);
assert(viewerSchedulingTools.length === 2, "Viewers must only receive the two read-only scheduling tools");
assert(viewerSchedulingTools.every((tool) => tool.riskLevel === "read"), "Viewer role must never receive write scheduling actions");
assert(!viewerSchedulingTools.some((tool) => ["scheduling.create_booking", "scheduling.reschedule_booking", "scheduling.cancel_booking"].includes(tool.id)), "Viewer role must not see mutating scheduling actions");

console.log("Tool registry tests passed");
