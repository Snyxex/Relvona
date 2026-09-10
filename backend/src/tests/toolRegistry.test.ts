import { toolRegistry } from "../services/toolRegistry.js";
import { validateToolInput } from "../services/toolInputValidator.js";

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
const integrationToolIds = [
  "hubspot.get_contact",
  "hubspot.create_contact",
  "hubspot.update_contact",
  "hubspot.search_companies",
  "hubspot.create_company",
  "zendesk.get_ticket",
  "zendesk.create_ticket",
  "zendesk.add_comment",
  "zendesk.update_ticket",
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

const agentIntegrationTools = toolRegistry.getAvailableTools({ actorRole: "agent" }, integrationToolIds);
assert(agentIntegrationTools.length === integrationToolIds.length, "Agents must see all configured integration tools");
for (const toolId of ["hubspot.get_contact", "hubspot.search_companies", "zendesk.get_ticket"]) {
  const tool = agentIntegrationTools.find((candidate) => candidate.id === toolId);
  assert(Boolean(tool), `${toolId} must be registered`);
  assert(tool?.riskLevel === "read", `${toolId} must remain read-only`);
  assert(tool?.requiresApproval === false, `${toolId} must not require approval`);
}
for (const toolId of ["hubspot.create_contact", "hubspot.update_contact", "hubspot.create_company", "zendesk.create_ticket", "zendesk.add_comment", "zendesk.update_ticket"]) {
  const tool = agentIntegrationTools.find((candidate) => candidate.id === toolId);
  assert(Boolean(tool), `${toolId} must be registered`);
  assert(tool?.riskLevel === "write", `${toolId} must remain a write action`);
  assert(tool?.requiresApproval === true, `${toolId} must require explicit approval`);
}
const viewerIntegrationTools = toolRegistry.getAvailableTools({ actorRole: "viewer" }, integrationToolIds);
assert(viewerIntegrationTools.length === 3, "Viewers must only receive integration read tools");
assert(viewerIntegrationTools.every((tool) => tool.riskLevel === "read"), "Viewer role must never receive integration write actions");
assert(!viewerIntegrationTools.some((tool) => tool.requiresApproval), "Viewer integration tools must not include approval-gated writes");

const bookingTool = toolRegistry.get("scheduling.create_booking");
assert(Boolean(bookingTool), "Create booking tool must be registered");
if (bookingTool) {
  assert(validateToolInput(bookingTool.inputSchema, {
    meetingTypeId: "c9b1ad0e-e72b-4c44-9d0a-2fd15ef44f48",
    startsAt: "2026-09-15T10:00:00.000Z",
    timezone: "Europe/Berlin",
    idempotencyKey: "test-key",
  }).valid, "valid booking input must pass schema validation");
  assert(!validateToolInput(bookingTool.inputSchema, {
    meetingTypeId: "not-a-uuid",
    startsAt: "2026-09-15T10:00:00.000Z",
    timezone: "Europe/Berlin",
    idempotencyKey: "test-key",
  }).valid, "invalid booking UUID must be rejected");
  assert(!validateToolInput(bookingTool.inputSchema, {
    meetingTypeId: "c9b1ad0e-e72b-4c44-9d0a-2fd15ef44f48",
    startsAt: "2026-09-15T10:00:00.000Z",
    timezone: "Europe/Berlin",
    idempotencyKey: "test-key",
    organizationId: "attacker-controlled",
  }).valid, "unexpected fields must be rejected");
}

const hubspotContactTool = toolRegistry.get("hubspot.create_contact");
assert(Boolean(hubspotContactTool), "HubSpot contact tool must be registered");
if (hubspotContactTool) assert(!validateToolInput(hubspotContactTool.inputSchema, { email: "invalid-email" }).valid, "invalid email must be rejected");

const zendeskUpdateTool = toolRegistry.get("zendesk.update_ticket");
assert(Boolean(zendeskUpdateTool), "Zendesk update tool must be registered");
if (zendeskUpdateTool) assert(!validateToolInput(zendeskUpdateTool.inputSchema, { ticketId: "123", status: "deleted" }).valid, "invalid enum value must be rejected");

const companySearchTool = toolRegistry.get("hubspot.search_companies");
assert(Boolean(companySearchTool), "HubSpot company search tool must be registered");
if (companySearchTool) assert(!validateToolInput(companySearchTool.inputSchema, { query: "OpenAI", limit: 100 }).valid, "numeric maximum must be enforced");

console.log("Tool registry and input validation tests passed");
