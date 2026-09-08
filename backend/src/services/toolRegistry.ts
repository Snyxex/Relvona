import { SchedulingService } from "./schedulingService.js";
import { TicketCaseService } from "./ticketCaseService.js";

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
    try { return { success: true, data: await TicketCaseService.detail(context.organizationId, input.ticketId) as unknown as Record<string, unknown> }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
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
      const slots = await SchedulingService.findAvailableSlots({ organizationId: context.organizationId, meetingTypeId: input.meetingTypeId, assignedUserId: typeof input.assignedUserId === "string" ? input.assignedUserId : undefined, from: new Date(input.from), to: new Date(input.to), limit: typeof input.limit === "number" ? input.limit : undefined });
      return { success: true, data: { slots } as unknown as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "scheduling.list_bookings",
  name: "List bookings",
  description: "Read bookings for the current organization.",
  inputSchema: { type: "object", properties: {} },
  riskLevel: "read", requiresApproval: false,
  async execute(context) { return { success: true, data: { bookings: await SchedulingService.listBookings(context.organizationId) } as unknown as Record<string, unknown> }; },
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
      const booking = await SchedulingService.createBooking({ organizationId: context.organizationId, meetingTypeId: input.meetingTypeId, assignedUserId: typeof input.assignedUserId === "string" ? input.assignedUserId : undefined, customerId: context.customerId, conversationId: context.conversationId, guestEmail: typeof input.guestEmail === "string" ? input.guestEmail : undefined, guestName: typeof input.guestName === "string" ? input.guestName : undefined, startsAt: new Date(input.startsAt), timezone: input.timezone, idempotencyKey: input.idempotencyKey, createdBy: "ai" });
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
      const booking = await SchedulingService.rescheduleBooking({ organizationId: context.organizationId, bookingId: input.bookingId, startsAt: new Date(input.startsAt), timezone: input.timezone, actorType: "ai", actorUserId: context.actorUserId });
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
    try { return { success: true, data: { booking: await SchedulingService.cancelBooking({ organizationId: context.organizationId, bookingId: input.bookingId, actorType: "ai", actorUserId: context.actorUserId }) } as unknown as Record<string, unknown> }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

export { registry as toolRegistry };
