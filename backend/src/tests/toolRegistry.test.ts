import { toolRegistry } from "../services/toolRegistry.js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const toolIds = ["demo.get_server_status", "demo.restart_service"];
const viewerTools = toolRegistry.getAvailableTools({ actorRole: "viewer" }, toolIds);
assert(viewerTools.length === 1 && viewerTools[0].id === "demo.get_server_status", "Viewers must only see read tools");

const agentTools = toolRegistry.getAvailableTools({ actorRole: "agent" }, toolIds);
const restartTool = agentTools.find((tool) => tool.id === "demo.restart_service");
assert(Boolean(restartTool), "Agents must see enabled write tools");
assert(restartTool?.requiresApproval === true, "Write demo tool must require approval");

console.log("Tool registry tests passed");
