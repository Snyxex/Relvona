import { IntegrationConnectionService } from "./integrationConnectionService.js";

function validEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value) && value.length <= 254;
}

function trimOptional(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

export class HubSpotExtendedAdapter {
  static async updateContact(
    organizationId: string,
    input: { contactId: string; email?: string; firstName?: string; lastName?: string; phone?: string; company?: string },
    connectionId?: string,
  ) {
    const contactId = input.contactId.trim();
    if (!/^[A-Za-z0-9._@+\-]{1,254}$/.test(contactId)) throw new Error("Invalid HubSpot contact id");

    const properties: Record<string, string> = {};
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (!validEmail(email)) throw new Error("Invalid contact email");
      properties.email = email;
    }
    const firstName = trimOptional(input.firstName, 120);
    const lastName = trimOptional(input.lastName, 120);
    const phone = trimOptional(input.phone, 80);
    const company = trimOptional(input.company, 160);
    if (firstName !== undefined) properties.firstname = firstName;
    if (lastName !== undefined) properties.lastname = lastName;
    if (phone !== undefined) properties.phone = phone;
    if (company !== undefined) properties.company = company;
    if (Object.keys(properties).length === 0) throw new Error("No HubSpot contact fields to update");

    return IntegrationConnectionService.request({
      organizationId,
      provider: "hubspot",
      connectionId,
      method: "PATCH",
      path: `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
      body: { properties },
    });
  }

  static async searchCompanies(
    organizationId: string,
    input: { query?: string; domain?: string; limit?: number },
    connectionId?: string,
  ) {
    const query = trimOptional(input.query, 200);
    const domain = trimOptional(input.domain, 253)?.toLowerCase();
    if (!query && !domain) throw new Error("query or domain is required");
    if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("Invalid company domain");
    const limit = Math.min(Math.max(Number.isFinite(input.limit) ? Number(input.limit) : 10, 1), 25);
    const body: Record<string, unknown> = {
      limit,
      properties: ["name", "domain", "website", "phone", "city", "country"],
    };
    if (query) body.query = query;
    if (domain) {
      body.filterGroups = [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }];
    }
    return IntegrationConnectionService.request({
      organizationId,
      provider: "hubspot",
      connectionId,
      method: "POST",
      path: "/crm/v3/objects/companies/search",
      body,
    });
  }

  static async createCompany(
    organizationId: string,
    input: { name: string; domain?: string; website?: string; phone?: string; city?: string; country?: string },
    connectionId?: string,
  ) {
    const name = input.name.trim();
    if (!name || name.length > 200) throw new Error("Invalid company name");
    const properties: Record<string, string> = { name };
    const domain = trimOptional(input.domain, 253)?.toLowerCase();
    if (domain) {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("Invalid company domain");
      properties.domain = domain;
    }
    const website = trimOptional(input.website, 500);
    if (website) {
      let parsed: URL;
      try { parsed = new URL(website); } catch { throw new Error("Invalid company website"); }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid company website");
      properties.website = parsed.toString();
    }
    const phone = trimOptional(input.phone, 80);
    const city = trimOptional(input.city, 120);
    const country = trimOptional(input.country, 120);
    if (phone) properties.phone = phone;
    if (city) properties.city = city;
    if (country) properties.country = country;

    return IntegrationConnectionService.request({
      organizationId,
      provider: "hubspot",
      connectionId,
      method: "POST",
      path: "/crm/v3/objects/companies",
      body: { properties },
    });
  }
}

export class ZendeskExtendedAdapter {
  private static ticketPath(ticketId: string) {
    const normalized = ticketId.trim();
    if (!/^\d{1,20}$/.test(normalized)) throw new Error("Invalid Zendesk ticket id");
    return `/api/v2/tickets/${normalized}.json`;
  }

  static async addComment(
    organizationId: string,
    input: { ticketId: string; body: string; public?: boolean },
    connectionId?: string,
  ) {
    const body = input.body.trim();
    if (!body || body.length > 10_000) throw new Error("Invalid Zendesk comment body");
    return IntegrationConnectionService.request({
      organizationId,
      provider: "zendesk",
      connectionId,
      method: "PUT",
      path: this.ticketPath(input.ticketId),
      body: { ticket: { comment: { body, public: input.public !== false } } },
    });
  }

  static async updateTicket(
    organizationId: string,
    input: { ticketId: string; status?: string; priority?: string },
    connectionId?: string,
  ) {
    const ticket: Record<string, string> = {};
    if (input.status !== undefined) {
      if (!["new", "open", "pending", "hold", "solved"].includes(input.status)) throw new Error("Invalid Zendesk ticket status");
      ticket.status = input.status;
    }
    if (input.priority !== undefined) {
      if (!["low", "normal", "high", "urgent"].includes(input.priority)) throw new Error("Invalid Zendesk ticket priority");
      ticket.priority = input.priority;
    }
    if (Object.keys(ticket).length === 0) throw new Error("No Zendesk ticket fields to update");
    return IntegrationConnectionService.request({
      organizationId,
      provider: "zendesk",
      connectionId,
      method: "PUT",
      path: this.ticketPath(input.ticketId),
      body: { ticket },
    });
  }
}
