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

export { registry as toolRegistry };
