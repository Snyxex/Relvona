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

  register(tool: SupportTool) {
    if (this.tools.has(tool.id)) throw new Error(`Tool '${tool.id}' is already registered`);
    this.tools.set(tool.id, tool);
  }

  get(id: string) { return this.tools.get(id); }

  getAvailableTools(context: Pick<ToolExecutionContext, "actorRole">, enabledToolIds: string[]) {
    return enabledToolIds
      .map((id) => this.tools.get(id))
      .filter((tool): tool is SupportTool => Boolean(tool))
      .filter((tool) => context.actorRole !== "viewer" || tool.riskLevel === "read");
  }
}

const registry = new ToolRegistry();

registry.register({
  id: "demo.get_server_status",
  name: "Get server status",
  description: "Returns a demo service status. It performs no external request.",
  inputSchema: { type: "object", properties: { serverId: { type: "string" } }, required: ["serverId"] },
  riskLevel: "read",
  requiresApproval: false,
  async execute(_context, input) {
    const serverId = typeof input.serverId === "string" ? input.serverId.slice(0, 100) : "unknown";
    return { success: true, data: { serverId, status: "healthy", source: "demo" } };
  },
});

registry.register({
  id: "demo.restart_service",
  name: "Restart service",
  description: "Demo write action. It does not restart a real service.",
  inputSchema: { type: "object", properties: { service: { type: "string" } }, required: ["service"] },
  riskLevel: "write",
  requiresApproval: true,
  async execute(_context, input) {
    const service = typeof input.service === "string" ? input.service.slice(0, 100) : "unknown";
    return { success: true, data: { service, status: "restart_queued", source: "demo" } };
  },
});

registry.register({
  id: "support.get_ticket_case",
  name: "Get ticket case",
  description: "Read the SLA state and timeline for a support ticket in the current organization.",
  inputSchema: { type: "object", properties: { ticketId: { type: "string", format: "uuid" } }, required: ["ticketId"] },
  riskLevel: "read",
  requiresApproval: false,
  async execute(context, input) {
    if (typeof input.ticketId !== "string") return { success: false, error: "ticketId is required" };
    try { return { success: true, data: await TicketCaseService.detail(context.organizationId, input.ticketId) as unknown as Record<string, unknown> }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "scheduling.list_bookings",
  name: "List bookings",
  description: "Read bookings for the current organization.",
  inputSchema: { type: "object", properties: {} },
  riskLevel: "read",
  requiresApproval: false,
  async execute(context) {
    const rows = await SchedulingService.listBookings(context.organizationId);
    return { success: true, data: { bookings: rows } as unknown as Record<string, unknown> };
  },
});

registry.register({
  id: "scheduling.create_booking",
  name: "Create booking",
  description: "Create a meeting booking. This is a customer-visible write action and requires approval before execution.",
  inputSchema: {
    type: "object",
    properties: {
      meetingTypeId: { type: "string", format: "uuid" },
      assignedUserId: { type: "string", format: "uuid" },
      startsAt: { type: "string", format: "date-time" },
      timezone: { type: "string" },
      guestEmail: { type: "string", format: "email" },
      guestName: { type: "string" },
      idempotencyKey: { type: "string" },
    },
    required: ["meetingTypeId", "startsAt", "timezone", "idempotencyKey"],
  },
  riskLevel: "write",
  requiresApproval: true,
  async execute(context, input) {
    try {
      if (typeof input.meetingTypeId !== "string" || typeof input.startsAt !== "string" || typeof input.timezone !== "string" || typeof input.idempotencyKey !== "string") return { success: false, error: "Invalid booking input" };
      const booking = await SchedulingService.createBooking({
        organizationId: context.organizationId,
        meetingTypeId: input.meetingTypeId,
        assignedUserId: typeof input.assignedUserId === "string" ? input.assignedUserId : undefined,
        customerId: context.customerId,
        conversationId: context.conversationId,
        guestEmail: typeof input.guestEmail === "string" ? input.guestEmail : undefined,
        guestName: typeof input.guestName === "string" ? input.guestName : undefined,
        startsAt: new Date(input.startsAt),
        timezone: input.timezone,
        idempotencyKey: input.idempotencyKey,
        createdBy: "ai",
      });
      return { success: true, data: { booking } as unknown as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

registry.register({
  id: "scheduling.cancel_booking",
  name: "Cancel booking",
  description: "Cancel an existing meeting booking. Requires approval before execution.",
  inputSchema: { type: "object", properties: { bookingId: { type: "string", format: "uuid" } }, required: ["bookingId"] },
  riskLevel: "write",
  requiresApproval: true,
  async execute(context, input) {
    if (typeof input.bookingId !== "string") return { success: false, error: "bookingId is required" };
    try {
      const booking = await SchedulingService.cancelBooking({ organizationId: context.organizationId, bookingId: input.bookingId, actorType: "ai", actorUserId: context.actorUserId });
      return { success: true, data: { booking } as unknown as Record<string, unknown> };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  },
});

export { registry as toolRegistry };
