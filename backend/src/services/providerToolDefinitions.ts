import type { SupportTool } from "./toolRegistry.js";
import { HubSpotExtendedAdapter, ZendeskExtendedAdapter } from "./providerActionService.js";

export const providerExtendedTools: SupportTool[] = [
  {
    id: "hubspot.update_contact",
    name: "Update HubSpot contact",
    description: "Update selected properties of an existing HubSpot CRM contact. External write requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        email: { type: "string", format: "email" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        phone: { type: "string" },
        company: { type: "string" },
        connectionId: { type: "string", format: "uuid" },
      },
      required: ["contactId"],
    },
    riskLevel: "write",
    requiresApproval: true,
    async execute(context, input) {
      if (typeof input.contactId !== "string") return { success: false, error: "contactId is required" };
      try {
        const contact = await HubSpotExtendedAdapter.updateContact(context.organizationId, {
          contactId: input.contactId,
          email: typeof input.email === "string" ? input.email : undefined,
          firstName: typeof input.firstName === "string" ? input.firstName : undefined,
          lastName: typeof input.lastName === "string" ? input.lastName : undefined,
          phone: typeof input.phone === "string" ? input.phone : undefined,
          company: typeof input.company === "string" ? input.company : undefined,
        }, typeof input.connectionId === "string" ? input.connectionId : undefined);
        return { success: true, data: { contact } as Record<string, unknown> };
      } catch (error) { return { success: false, error: (error as Error).message }; }
    },
  },
  {
    id: "hubspot.search_companies",
    name: "Search HubSpot companies",
    description: "Search HubSpot companies by text or exact domain.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        domain: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 25 },
        connectionId: { type: "string", format: "uuid" },
      },
    },
    riskLevel: "read",
    requiresApproval: false,
    async execute(context, input) {
      try {
        const companies = await HubSpotExtendedAdapter.searchCompanies(context.organizationId, {
          query: typeof input.query === "string" ? input.query : undefined,
          domain: typeof input.domain === "string" ? input.domain : undefined,
          limit: typeof input.limit === "number" ? input.limit : undefined,
        }, typeof input.connectionId === "string" ? input.connectionId : undefined);
        return { success: true, data: { companies } as Record<string, unknown> };
      } catch (error) { return { success: false, error: (error as Error).message }; }
    },
  },
  {
    id: "hubspot.create_company",
    name: "Create HubSpot company",
    description: "Create a company in HubSpot CRM. External write requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        domain: { type: "string" },
        website: { type: "string", format: "uri" },
        phone: { type: "string" },
        city: { type: "string" },
        country: { type: "string" },
        connectionId: { type: "string", format: "uuid" },
      },
      required: ["name"],
    },
    riskLevel: "write",
    requiresApproval: true,
    async execute(context, input) {
      if (typeof input.name !== "string") return { success: false, error: "name is required" };
      try {
        const company = await HubSpotExtendedAdapter.createCompany(context.organizationId, {
          name: input.name,
          domain: typeof input.domain === "string" ? input.domain : undefined,
          website: typeof input.website === "string" ? input.website : undefined,
          phone: typeof input.phone === "string" ? input.phone : undefined,
          city: typeof input.city === "string" ? input.city : undefined,
          country: typeof input.country === "string" ? input.country : undefined,
        }, typeof input.connectionId === "string" ? input.connectionId : undefined);
        return { success: true, data: { company } as Record<string, unknown> };
      } catch (error) { return { success: false, error: (error as Error).message }; }
    },
  },
  {
    id: "zendesk.add_comment",
    name: "Add Zendesk ticket comment",
    description: "Add a public reply or internal note to a Zendesk ticket. External write requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string" },
        body: { type: "string" },
        public: { type: "boolean" },
        connectionId: { type: "string", format: "uuid" },
      },
      required: ["ticketId", "body"],
    },
    riskLevel: "write",
    requiresApproval: true,
    async execute(context, input) {
      if (typeof input.ticketId !== "string" || typeof input.body !== "string") return { success: false, error: "ticketId and body are required" };
      try {
        const ticket = await ZendeskExtendedAdapter.addComment(context.organizationId, {
          ticketId: input.ticketId,
          body: input.body,
          public: typeof input.public === "boolean" ? input.public : undefined,
        }, typeof input.connectionId === "string" ? input.connectionId : undefined);
        return { success: true, data: { ticket } as Record<string, unknown> };
      } catch (error) { return { success: false, error: (error as Error).message }; }
    },
  },
  {
    id: "zendesk.update_ticket",
    name: "Update Zendesk ticket",
    description: "Change Zendesk ticket status or priority. External write requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string" },
        status: { type: "string", enum: ["new", "open", "pending", "hold", "solved"] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        connectionId: { type: "string", format: "uuid" },
      },
      required: ["ticketId"],
    },
    riskLevel: "write",
    requiresApproval: true,
    async execute(context, input) {
      if (typeof input.ticketId !== "string") return { success: false, error: "ticketId is required" };
      try {
        const ticket = await ZendeskExtendedAdapter.updateTicket(context.organizationId, {
          ticketId: input.ticketId,
          status: typeof input.status === "string" ? input.status : undefined,
          priority: typeof input.priority === "string" ? input.priority : undefined,
        }, typeof input.connectionId === "string" ? input.connectionId : undefined);
        return { success: true, data: { ticket } as Record<string, unknown> };
      } catch (error) { return { success: false, error: (error as Error).message }; }
    },
  },
];
