import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { integrationConnections, type IntegrationProvider } from "../db/integrationConnectionSchema.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";

const REQUEST_TIMEOUT_MS = Number(process.env.INTEGRATION_REQUEST_TIMEOUT_MS || 15_000);
const MAX_RESPONSE_BYTES = Number(process.env.INTEGRATION_MAX_RESPONSE_BYTES || 1_000_000);

type HubSpotCredentials = { accessToken: string };
type ZendeskCredentials = { apiToken: string };
type IntegrationCredentials = HubSpotCredentials | ZendeskCredentials;

function publicConnection(row: typeof integrationConnections.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    config: row.config,
    enabled: row.enabled,
    status: row.status,
    credentialsConfigured: Boolean(row.encryptedCredentials),
    lastTestedAt: row.lastTestedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeName(value: string) {
  const name = value.trim();
  if (!name || name.length > 100) throw new Error("Invalid integration name");
  return name;
}

function normalizeConfig(provider: IntegrationProvider, input: Record<string, unknown>) {
  if (provider === "hubspot") return {};
  const subdomain = typeof input.subdomain === "string" ? input.subdomain.trim().toLowerCase() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(subdomain)) throw new Error("Invalid Zendesk subdomain");
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("Invalid Zendesk account email");
  return { subdomain, email };
}

function normalizeCredentials(provider: IntegrationProvider, input: Record<string, unknown>): IntegrationCredentials {
  if (provider === "hubspot") {
    const accessToken = typeof input.accessToken === "string" ? input.accessToken.trim() : "";
    if (accessToken.length < 20 || accessToken.length > 500) throw new Error("Invalid HubSpot access token");
    return { accessToken };
  }
  const apiToken = typeof input.apiToken === "string" ? input.apiToken.trim() : "";
  if (apiToken.length < 10 || apiToken.length > 500) throw new Error("Invalid Zendesk API token");
  return { apiToken };
}

async function readJsonBounded(response: Response): Promise<any> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Integration response exceeds size limit");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Integration response exceeds size limit");
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new Error("Integration returned invalid JSON"); }
}

export class IntegrationConnectionService {
  static async list(organizationId: string) {
    const rows = await db.select().from(integrationConnections).where(eq(integrationConnections.organizationId, organizationId));
    return rows.map(publicConnection);
  }

  static async create(data: { organizationId: string; provider: IntegrationProvider; name: string; config: Record<string, unknown>; credentials: Record<string, unknown> }) {
    if (!["hubspot", "zendesk"].includes(data.provider)) throw new Error("Unsupported integration provider");
    const config = normalizeConfig(data.provider, data.config || {});
    const credentials = normalizeCredentials(data.provider, data.credentials || {});
    const encryptedCredentials = encryptSecret(JSON.stringify(credentials));
    if (!encryptedCredentials) throw new Error("Unable to encrypt integration credentials");
    const [created] = await db.insert(integrationConnections).values({
      organizationId: data.organizationId,
      provider: data.provider,
      name: normalizeName(data.name),
      config,
      encryptedCredentials,
    }).returning();
    return publicConnection(created);
  }

  static async update(data: { organizationId: string; id: string; name?: string; enabled?: boolean; config?: Record<string, unknown>; credentials?: Record<string, unknown> }) {
    const [current] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, data.organizationId), eq(integrationConnections.id, data.id))).limit(1);
    if (!current) throw new Error("Integration connection not found");
    const config = data.config === undefined ? undefined : normalizeConfig(current.provider, data.config);
    const credentials = data.credentials === undefined ? undefined : normalizeCredentials(current.provider, data.credentials);
    const encryptedCredentials = credentials ? (encryptSecret(JSON.stringify(credentials)) || undefined) : undefined;
    const [updated] = await db.update(integrationConnections).set({
      name: data.name === undefined ? undefined : normalizeName(data.name),
      enabled: data.enabled,
      config,
      encryptedCredentials,
      status: credentials || config ? "untested" : undefined,
      lastError: credentials || config ? null : undefined,
      updatedAt: new Date(),
    }).where(and(eq(integrationConnections.organizationId, data.organizationId), eq(integrationConnections.id, data.id))).returning();
    return publicConnection(updated);
  }

  static async remove(organizationId: string, id: string) {
    const [deleted] = await db.delete(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.id, id))).returning({ id: integrationConnections.id });
    if (!deleted) throw new Error("Integration connection not found");
  }

  static async getUsable(organizationId: string, provider: IntegrationProvider, id?: string) {
    const [row] = await db.select().from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, organizationId),
      eq(integrationConnections.provider, provider),
      eq(integrationConnections.enabled, true),
      id ? eq(integrationConnections.id, id) : undefined,
    )).limit(1);
    if (!row) throw new Error(`${provider} integration is not configured`);
    const plaintext = decryptSecret(row.encryptedCredentials);
    if (!plaintext) throw new Error("Integration credentials cannot be decrypted");
    let credentials: IntegrationCredentials;
    try { credentials = JSON.parse(plaintext); }
    catch { throw new Error("Integration credentials are invalid"); }
    return { row, credentials };
  }

  static async request(data: { organizationId: string; provider: IntegrationProvider; connectionId?: string; method: string; path: string; body?: Record<string, unknown> }) {
    const { row, credentials } = await this.getUsable(data.organizationId, data.provider, data.connectionId);
    let url: string;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (data.provider === "hubspot") {
      if (!data.path.startsWith("/crm/")) throw new Error("HubSpot path is not allowed");
      url = `https://api.hubapi.com${data.path}`;
      headers.Authorization = `Bearer ${(credentials as HubSpotCredentials).accessToken}`;
    } else {
      if (!data.path.startsWith("/api/v2/")) throw new Error("Zendesk path is not allowed");
      const config = row.config as { subdomain?: string; email?: string };
      if (!config.subdomain || !config.email) throw new Error("Zendesk configuration is incomplete");
      url = `https://${config.subdomain}.zendesk.com${data.path}`;
      headers.Authorization = `Basic ${Buffer.from(`${config.email}/token:${(credentials as ZendeskCredentials).apiToken}`, "utf8").toString("base64")}`;
    }
    if (data.body) headers["Content-Type"] = "application/json";
    const response = await fetch(url, { method: data.method, headers, body: data.body ? JSON.stringify(data.body) : undefined, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const payload = await readJsonBounded(response);
    if (!response.ok) throw new Error(`${data.provider} request failed with HTTP ${response.status}`);
    return payload;
  }

  static async test(organizationId: string, id: string) {
    const [connection] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.id, id))).limit(1);
    if (!connection) throw new Error("Integration connection not found");
    try {
      if (connection.provider === "hubspot") await this.request({ organizationId, provider: "hubspot", connectionId: id, method: "GET", path: "/crm/v3/objects/contacts?limit=1&archived=false" });
      else await this.request({ organizationId, provider: "zendesk", connectionId: id, method: "GET", path: "/api/v2/users/me.json" });
      const [updated] = await db.update(integrationConnections).set({ status: "connected", lastTestedAt: new Date(), lastError: null, updatedAt: new Date() }).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.id, id))).returning();
      return publicConnection(updated);
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      await db.update(integrationConnections).set({ status: "error", lastTestedAt: new Date(), lastError: message, updatedAt: new Date() }).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.id, id)));
      throw new Error(message);
    }
  }
}

export class HubSpotAdapter {
  static async getContactByEmail(organizationId: string, email: string, connectionId?: string) {
    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("Invalid contact email");
    return IntegrationConnectionService.request({ organizationId, provider: "hubspot", connectionId, method: "GET", path: `/crm/v3/objects/contacts/${encodeURIComponent(normalized)}?idProperty=email&properties=email,firstname,lastname,phone,company` });
  }

  static async createContact(organizationId: string, input: { email: string; firstName?: string; lastName?: string; phone?: string; company?: string }, connectionId?: string) {
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid contact email");
    const properties: Record<string, string> = { email };
    if (input.firstName?.trim()) properties.firstname = input.firstName.trim().slice(0, 120);
    if (input.lastName?.trim()) properties.lastname = input.lastName.trim().slice(0, 120);
    if (input.phone?.trim()) properties.phone = input.phone.trim().slice(0, 80);
    if (input.company?.trim()) properties.company = input.company.trim().slice(0, 160);
    return IntegrationConnectionService.request({ organizationId, provider: "hubspot", connectionId, method: "POST", path: "/crm/v3/objects/contacts", body: { properties } });
  }
}

export class ZendeskAdapter {
  static async getTicket(organizationId: string, ticketId: string, connectionId?: string) {
    if (!/^\d{1,20}$/.test(ticketId)) throw new Error("Invalid Zendesk ticket id");
    return IntegrationConnectionService.request({ organizationId, provider: "zendesk", connectionId, method: "GET", path: `/api/v2/tickets/${ticketId}.json` });
  }

  static async createTicket(organizationId: string, input: { subject?: string; body: string; priority?: string; requesterEmail?: string; requesterName?: string }, connectionId?: string) {
    const body = input.body.trim();
    if (!body || body.length > 10_000) throw new Error("Invalid Zendesk ticket body");
    const ticket: Record<string, unknown> = { comment: { body } };
    if (input.subject?.trim()) ticket.subject = input.subject.trim().slice(0, 300);
    if (["low", "normal", "high", "urgent"].includes(input.priority || "")) ticket.priority = input.priority;
    if (input.requesterEmail?.trim()) {
      const email = input.requesterEmail.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid requester email");
      ticket.requester = { email, name: input.requesterName?.trim().slice(0, 120) || undefined };
    }
    return IntegrationConnectionService.request({ organizationId, provider: "zendesk", connectionId, method: "POST", path: "/api/v2/tickets.json", body: { ticket } });
  }
}
