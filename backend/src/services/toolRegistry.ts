import { SchedulingService } from "./schedulingService.js";
import { SchedulingAuthorizationService } from "./schedulingAuthorizationService.js";
import { TicketCaseService } from "./ticketCaseService.js";
import { HubSpotAdapter, ZendeskAdapter } from "./integrationConnectionService.js";
import { providerExtendedTools } from "./providerToolDefinitions.js";

export type ToolRiskLevel = "read" | "write" | "sensitive";

export interface ToolExecutionContext {
  organizationId: string;
  conversationId?: string;
  customerId?: string;
  actorUserId?: string;
  actorRole: string;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface SupportTool {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  execute(context: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolExecutionResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, SupportTool>();
  register(tool: SupportTool) { if (this.tools.has(tool.id)) throw new Error(`Tool '${tool.id}' is already registered`); this.tools.set(tool.id, tool); }
  get(id: string) { return this.tools.get(id); }
  getAvailableTools(context: Pick<ToolExecutionContext, "actorRole">, enabledToolIds: string[]) {
    return enabledToolIds.map((id) => this.tools.get(id)).filter((tool): tool is SupportTool => Boolean(tool)).filter((tool) => context.actorRole !== "viewer" || tool.riskLevel === "read");
  }
}

const registry = new ToolRegistry();

registry.register({
  id: "support.get_ticket_case",
  name: "Get ticket case",
  description: "Read the SLA state and timeline for a support ticket in the current organization.",
  inputSchema: { type: "object", properties: { ticketId: { type: "string", format: "uuid" } }, required: ["ticketId"] },
  riskLevel: "read", requiresApproval: false,
  async execute(context, input) {
    if (typeof input.ticketId !== "string") return { success: false, error: "ticketId is required" };
    try {
      const detail = await TicketCaseService.detail(context.organizationId, input.ticketId);
      if (context.customerId && detail.ticket.customerId !== context.customerId) return { success: false, error: "Ticket not found" };
      return { success: true, data: detail as unknown as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "scheduling.find_available_slots",
  name: "Find available meeting slots",
  description: "Find available time slots from scheduling rules, internal bookings, and connected external calendars.",
  inputSchema: { type: "object", properties: { meetingTypeId: { type: "string", format: "uuid" }, assignedUserId: { type: "string", format: "uuid" }, from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" }, limit: { type: "number" } }, required: ["meetingTypeId", "from", "to"] },
  riskLevel: "read", requiresApproval: false,
  async execute(context, input) {
    if (typeof input.meetingTypeId !== "string" || typeof input.from !== "string" || typeof input.to !== "string") return { success: false, error: "Invalid slot search input" };
    try {
      const assignedUserId = typeof input.assignedUserId === "string" ? input.assignedUserId : undefined;
      await SchedulingAuthorizationService.assertSchedulableMember(context.organizationId, assignedUserId);
      const slots = await SchedulingService.findAvailableSlots({ organizationId: context.organizationId, meetingTypeId: input.meetingTypeId, assignedUserId, from: new Date(input.from), to: new Date(input.to), limit: typeof input.limit === "number" ? input.limit : undefined });
      return { success: true, data: { slots } as unknown as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "scheduling.list_bookings",
  name: "List bookings",
  description: "Read bookings for the current organization, scoped to the conversation customer when one is present.",
  inputSchema: { type: "object", properties: {} },
  riskLevel: "read", requiresApproval: false,
  async execute(context) {
    return { success: true, data: { bookings: await SchedulingService.listBookings(context.organizationId, context.customerId) } as unknown as Record<string, unknown> };
  },
});

registry.register({
  id: "scheduling.create_booking",
  name: "Create booking",
  description: "Create a meeting booking. This customer-visible write action requires approval.",
  inputSchema: { type: "object", properties: { meetingTypeId: { type: "string", format: "uuid" }, assignedUserId: { type: "string", format: "uuid" }, startsAt: { type: "string", format: "date-time" }, timezone: { type: "string" }, guestEmail: { type: "string", format: "email" }, guestName: { type: "string" }, idempotencyKey: { type: "string" } }, required: ["meetingTypeId", "startsAt", "timezone", "idempotencyKey"] },
  riskLevel: "write", requiresApproval: true,
  async execute(context, input) {
    try {
      if (typeof input.meetingTypeId !== "string" || typeof input.startsAt !== "string" || typeof input.timezone !== "string" || typeof input.idempotencyKey !== "string") return { success: false, error: "Invalid booking input" };
      const assignedUserId = typeof input.assignedUserId === "string" ? input.assignedUserId : undefined;
      await SchedulingAuthorizationService.assertSchedulableMember(context.organizationId, assignedUserId);
      const booking = await SchedulingService.createBooking({ organizationId: context.organizationId, meetingTypeId: input.meetingTypeId, assignedUserId, customerId: context.customerId, conversationId: context.conversationId, guestEmail: typeof input.guestEmail === "string" ? input.guestEmail : undefined, guestName: typeof input.guestName === "string" ? input.guestName : undefined, startsAt: new Date(input.startsAt), timezone: input.timezone, idempotencyKey: input.idempotencyKey, createdBy: "ai" });
      return { success: true, data: { booking } as unknown as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "scheduling.reschedule_booking",
  name: "Reschedule booking",
  description: "Move an existing booking and synchronize its connected calendar event. Requires approval.",
  inputSchema: { type: "object", properties: { bookingId: { type: "string", format: "uuid" }, startsAt: { type: "string", format: "date-time" }, timezone: { type: "string" } }, required: ["bookingId", "startsAt", "timezone"] },
  riskLevel: "write", requiresApproval: true,
  async execute(context, input) {
    if (typeof input.bookingId !== "string" || typeof input.startsAt !== "string" || typeof input.timezone !== "string") return { success: false, error: "Invalid reschedule input" };
    try {
      const booking = await SchedulingService.rescheduleBooking({ organizationId: context.organizationId, bookingId: input.bookingId, startsAt: new Date(input.startsAt), timezone: input.timezone, actorType: "ai", actorUserId: context.actorUserId, expectedCustomerId: context.customerId });
      return { success: true, data: { booking } as unknown as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "scheduling.cancel_booking",
  name: "Cancel booking",
  description: "Cancel an existing meeting booking. Requires approval.",
  inputSchema: { type: "object", properties: { bookingId: { type: "string", format: "uuid" } }, required: ["bookingId"] },
  riskLevel: "write", requiresApproval: true,
  async execute(context, input) {
    if (typeof input.bookingId !== "string") return { success: false, error: "bookingId is required" };
    try { return { success: true, data: { booking: await SchedulingService.cancelBooking({ organizationId: context.organizationId, bookingId: input.bookingId, actorType: "ai", actorUserId: context.actorUserId, expectedCustomerId: context.customerId }) } as unknown as Record<string, unknown> }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "hubspot.get_contact",
  name: "Get HubSpot contact",
  description: "Read a HubSpot CRM contact by email from the current organization's configured HubSpot connection.",
  inputSchema: { type: "object", properties: { email: { type: "string", format: "email" }, connectionId: { type: "string", format: "uuid" } }, required: ["email"] },
  riskLevel: "read", requiresApproval: false,
  async execute(context, input) {
    if (typeof input.email !== "string") return { success: false, error: "email is required" };
    try { return { success: true, data: { contact: await HubSpotAdapter.getContactByEmail(context.organizationId, input.email, typeof input.connectionId === "string" ? input.connectionId : undefined) } as Record<string, unknown> }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "hubspot.create_contact",
  name: "Create HubSpot contact",
  description: "Create a contact in HubSpot CRM. This external write requires approval.",
  inputSchema: { type: "object", properties: { email: { type: "string", format: "email" }, firstName: { type: "string" }, lastName: { type: "string" }, phone: { type: "string" }, company: { type: "string" }, connectionId: { type: "string", format: "uuid" } }, required: ["email"] },
  riskLevel: "write", requiresApproval: true,
  async execute(context, input) {
    if (typeof input.email !== "string") return { success: false, error: "email is required" };
    try {
      const contact = await HubSpotAdapter.createContact(context.organizationId, { email: input.email, firstName: typeof input.firstName === "string" ? input.firstName : undefined, lastName: typeof input.lastName === "string" ? input.lastName : undefined, phone: typeof input.phone === "string" ? input.phone : undefined, company: typeof input.company === "string" ? input.company : undefined }, typeof input.connectionId === "string" ? input.connectionId : undefined);
      return { success: true, data: { contact } as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "zendesk.get_ticket",
  name: "Get Zendesk ticket",
  description: "Read a Zendesk Support ticket from the current organization's configured Zendesk connection.",
  inputSchema: { type: "object", properties: { ticketId: { type: "string" }, connectionId: { type: "string", format: "uuid" } }, required: ["ticketId"] },
  riskLevel: "read", requiresApproval: false,
  async execute(context, input) {
    if (typeof input.ticketId !== "string") return { success: false, error: "ticketId is required" };
    try { return { success: true, data: { ticket: await ZendeskAdapter.getTicket(context.organizationId, input.ticketId, typeof input.connectionId === "string" ? input.connectionId : undefined) } as Record<string, unknown> }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "zendesk.create_ticket",
  name: "Create Zendesk ticket",
  description: "Create a ticket in Zendesk Support. This external write requires approval.",
  inputSchema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, requesterEmail: { type: "string", format: "email" }, requesterName: { type: "string" }, connectionId: { type: "string", format: "uuid" } }, required: ["body"] },
  riskLevel: "write", requiresApproval: true,
  async execute(context, input) {
    if (typeof input.body !== "string") return { success: false, error: "body is required" };
    try {
      const ticket = await ZendeskAdapter.createTicket(context.organizationId, { subject: typeof input.subject === "string" ? input.subject : undefined, body: input.body, priority: typeof input.priority === "string" ? input.priority : undefined, requesterEmail: typeof input.requesterEmail === "string" ? input.requesterEmail : undefined, requesterName: typeof input.requesterName === "string" ? input.requesterName : undefined }, typeof input.connectionId === "string" ? input.connectionId : undefined);
      return { success: true, data: { ticket } as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

for (const tool of providerExtendedTools) registry.register(tool);

export { registry as toolRegistry };
