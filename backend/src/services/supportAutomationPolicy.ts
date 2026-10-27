export type AutomationTrigger = "ticket.created" | "ticket.updated" | "ticket.idle";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "pending" | "in_progress" | "resolved" | "closed";
export type AutomationConditions = {
  priorities?: TicketPriority[];
  statuses?: TicketStatus[];
  tagsAny?: string[];
  onlyUnassigned?: boolean;
  subjectIncludes?: string;
};
export type AutomationAction =
  | { type: "set_priority"; priority: TicketPriority }
  | { type: "assign_agent"; userId: string }
  | { type: "add_tag"; tag: string }
  | { type: "notify_admins"; message: string };
export type AutomationRuleInput = {
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: AutomationTrigger;
  idleMinutes: number | null;
  conditions: AutomationConditions;
  actions: AutomationAction[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const priorityList: TicketPriority[] = ["low", "normal", "high", "urgent"];
const statusList: TicketStatus[] = ["open", "pending", "in_progress", "resolved", "closed"];
const triggers: AutomationTrigger[] = ["ticket.created", "ticket.updated", "ticket.idle"];

export function parseAutomationRule(value: unknown): AutomationRuleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid automation rule");
  const obj = value as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim().length < 3 || obj.name.trim().length > 100) throw new Error("Invalid rule name");
  if (obj.description !== undefined && obj.description !== null && (typeof obj.description !== "string" || obj.description.length > 500)) throw new Error("Invalid rule description");
  if (typeof obj.enabled !== "boolean") throw new Error("Invalid enabled state");
  if (typeof obj.trigger !== "string" || !triggers.includes(obj.trigger as AutomationTrigger)) throw new Error("Invalid rule trigger");
  const trigger = obj.trigger as AutomationTrigger;
  const idleMinutes = trigger === "ticket.idle" ? obj.idleMinutes : null;
  if (trigger === "ticket.idle" && (!Number.isInteger(idleMinutes) || Number(idleMinutes) < 5 || Number(idleMinutes) > 10080)) throw new Error("Invalid idle threshold");
  if (!obj.conditions || typeof obj.conditions !== "object" || Array.isArray(obj.conditions)) throw new Error("Invalid conditions");
  const raw = obj.conditions as Record<string, unknown>;
  if (Object.keys(raw).some(k => !["priorities", "statuses", "tagsAny", "onlyUnassigned", "subjectIncludes"].includes(k))) throw new Error("Unknown condition");
  const conditions: AutomationConditions = {};
  if (raw.priorities !== undefined) {
    if (!Array.isArray(raw.priorities) || raw.priorities.length > 4 || raw.priorities.some(v => !priorityList.includes(v))) throw new Error("Invalid priorities");
    conditions.priorities = [...new Set(raw.priorities as TicketPriority[])];
  }
  if (raw.statuses !== undefined) {
    if (!Array.isArray(raw.statuses) || raw.statuses.length > 5 || raw.statuses.some(v => !statusList.includes(v))) throw new Error("Invalid statuses");
    conditions.statuses = [...new Set(raw.statuses as TicketStatus[])];
  }
  if (raw.tagsAny !== undefined) {
    if (!Array.isArray(raw.tagsAny) || raw.tagsAny.length > 10 || raw.tagsAny.some(v => typeof v !== "string" || !v.trim() || v.length > 64)) throw new Error("Invalid tags condition");
    conditions.tagsAny = [...new Set((raw.tagsAny as string[]).map(t => t.trim().toLowerCase()))];
  }
  if (raw.onlyUnassigned !== undefined) {
    if (typeof raw.onlyUnassigned !== "boolean") throw new Error("Invalid assignment condition");
    conditions.onlyUnassigned = raw.onlyUnassigned;
  }
  if (raw.subjectIncludes !== undefined) {
    if (typeof raw.subjectIncludes !== "string" || !raw.subjectIncludes.trim() || raw.subjectIncludes.length > 120) throw new Error("Invalid subject condition");
    conditions.subjectIncludes = raw.subjectIncludes.trim();
  }
  if (!Array.isArray(obj.actions) || obj.actions.length < 1 || obj.actions.length > 5) throw new Error("Invalid automation actions");
  const actions: AutomationAction[] = obj.actions.map(action => {
    if (!action || typeof action !== "object" || Array.isArray(action) || typeof action.type !== "string") throw new Error("Invalid automation action");
    const a = action as Record<string, unknown>;
    if (a.type === "set_priority" && priorityList.includes(a.priority as TicketPriority)) return { type: "set_priority", priority: a.priority as TicketPriority };
    if (a.type === "assign_agent" && typeof a.userId === "string" && uuid.test(a.userId)) return { type: "assign_agent", userId: a.userId };
    if (a.type === "add_tag" && typeof a.tag === "string" && a.tag.trim().length > 0 && a.tag.length <= 64) return { type: "add_tag", tag: a.tag.trim() };
    if (a.type === "notify_admins" && typeof a.message === "string" && a.message.trim().length > 0 && a.message.length <= 300) return { type: "notify_admins", message: a.message.trim() };
    throw new Error("Invalid automation action");
  });
  const distinct = new Set(actions.map(a => a.type));
  if (distinct.size !== actions.length) throw new Error("Duplicate action type");
  return { name: obj.name.trim(), description: typeof obj.description === "string" ? obj.description.trim() : null,
    enabled: obj.enabled, trigger, idleMinutes: trigger === "ticket.idle" ? idleMinutes as number : null, conditions, actions };
}

export function ruleMatches(conditions: AutomationConditions, ticket: {
  priority: string; status: string; assignedAgentId: string | null;
  tags: unknown; subject: string;
}): boolean {
  if (conditions.priorities && !conditions.priorities.includes(ticket.priority as TicketPriority)) return false;
  if (conditions.statuses && !conditions.statuses.includes(ticket.status as TicketStatus)) return false;
  if (conditions.onlyUnassigned && ticket.assignedAgentId) return false;
  if (conditions.subjectIncludes && !ticket.subject.toLowerCase().includes(conditions.subjectIncludes.toLowerCase())) return false;
  if (conditions.tagsAny) {
    const tags = Array.isArray(ticket.tags) ? ticket.tags.filter((v): v is string => typeof v === "string").map(v => v.toLowerCase()) : [];
    if (!conditions.tagsAny.some(tag => tags.includes(tag))) return false;
  }
  return true;
}

export function automationEventKey(trigger: AutomationTrigger, ticketId: string, timestamp: Date, extra = "") {
  // A rule runs once per observed ticket revision; idle rules once per idle episode.
  return `${trigger}:${ticketId}:${trigger === "ticket.created" ? "created" : timestamp.toISOString()}:${extra.slice(0, 100)}`;
}
