import { toolRegistry } from "../services/toolRegistry.js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const demoToolIds = ["demo.get_server_status", "demo.restart_service"];
const viewerDemoTools = toolRegistry.getAvailableTools({ actorRole: "viewer" }, demoToolIds);
assert(viewerDemoTools.length === 1 && viewerDemoTools[0].id === "demo.get_server_status", "Viewers must only see read demo tools");

const agentDemoTools = toolRegistry.getAvailableTools({ actorRole: "agent" }, demoToolIds);
const restartTool = agentDemoTools.find((tool) => tool.id === "demo.restart_service");
assert(Boolean(restartTool), "Agents must see enabled write tools");
assert(restartTool?.requiresApproval === true, "Write demo tool must require approval");

const schedulingToolIds = [
  "scheduling.find_available_slots",
  "scheduling.list_bookings",
  "scheduling.create_booking",
  "scheduling.reschedule_booking",
  "scheduling.cancel_booking",
];
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
assert(
  viewerSchedulingTools.every((tool) => tool.riskLevel === "read"),
  "Viewer role must never receive write scheduling actions",
);
assert(
  !viewerSchedulingTools.some((tool) => ["scheduling.create_booking", "scheduling.reschedule_booking", "scheduling.cancel_booking"].includes(tool.id)),
  "Viewer role must not see mutating scheduling actions",
);

console.log("Tool registry tests passed");
