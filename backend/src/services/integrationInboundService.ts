import crypto from "node:crypto";
import { and, desc, eq, isNotNull, lt, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { externalActors, externalTicketMessages } from "../db/externalTicketMessageSchema.js";
import { integrationInboundEvents } from "../db/integrationInboundSchema.js";
import { integrationSyncExecutions, integrationSyncRules } from "../db/integrationSyncSchema.js";
import { organizations, tickets } from "../db/schema.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { IntegrationConnectionService } from "./integrationConnectionService.js";
import { TicketService } from "./ticketService.js";

const MAX_TIMESTAMP_SKEW_MS = Number(process.env.ZENDESK_WEBHOOK_MAX_SKEW_MS || 5 * 60_000);
const PROCESSING_STALE_MS = Number(process.env.INTEGRATION_INBOUND_STALE_MS || 10 * 60_000);

type ZendeskTicketUpdatedPayload = {
  eventType: "ticket.updated";
  ticket: { id: string; status?: string; priority?: string };
};

type ZendeskCommentCreatedPayload = {
  eventType: "ticket.comment.created";
  ticket: { id: string };
  comment: {
    id: string;
    body: string;
    public: boolean;
    createdAt?: string;
    author: { id: string; name?: string; email?: string; role: "end-user" | "agent" | "admin" | "system" | "unknown" };
  };
};

type ZendeskInboundPayload = ZendeskTicketUpdatedPayload | ZendeskCommentCreatedPayload;

function timingSafeStringEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeTicketId(rawId: unknown) {
  const id = typeof rawId === "number" ? String(rawId) : typeof rawId === "string" ? rawId.trim() : "";
  if (!/^\d{1,20}$/.test(id)) throw new Error("Invalid Zendesk ticket id");
  return id;
}

function normalizeExternalId(rawId: unknown, label: string) {
  const id = typeof rawId === "number" ? String(rawId) : typeof rawId === "string" ? rawId.trim() : "";
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(id)) throw new Error(`Invalid Zendesk ${label} id`);
  return id;
}

function normalizeInboundPayload(value: unknown): ZendeskInboundPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Zendesk webhook payload");
  const payload = value as Record<string, unknown>;
  const ticket = payload.ticket;
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) throw new Error("Invalid Zendesk ticket payload");
  const ticketObject = ticket as Record<string, unknown>;
  const id = normalizeTicketId(ticketObject.id);

  if (payload.eventType === "ticket.updated") {
    const rawStatus = ticketObject.status;
    const rawPriority = ticketObject.priority;
    const status = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : undefined;
    const priority = typeof rawPriority === "string" ? rawPriority.trim().toLowerCase() : undefined;
    if (status !== undefined && !["new", "open", "pending", "hold", "solved", "closed"].includes(status)) throw new Error("Invalid Zendesk ticket status");
    if (priority !== undefined && !["low", "normal", "high", "urgent"].includes(priority)) throw new Error("Invalid Zendesk ticket priority");
    if (status === undefined && priority === undefined) throw new Error("Zendesk webhook has no supported ticket changes");
    return { eventType: "ticket.updated", ticket: { id, status, priority } };
  }

  if (payload.eventType === "ticket.comment.created") {
    const comment = payload.comment;
    if (!comment || typeof comment !== "object" || Array.isArray(comment)) throw new Error("Invalid Zendesk comment payload");
    const value = comment as Record<string, unknown>;
    const commentId = normalizeExternalId(value.id, "comment");
    const body = typeof value.body === "string" ? value.body.trim() : "";
    if (!body || body.length > 10_000) throw new Error("Invalid Zendesk comment body");
    if (typeof value.public !== "boolean") throw new Error("Invalid Zendesk comment visibility");
    const author = value.author;
    if (!author || typeof author !== "object" || Array.isArray(author)) throw new Error("Invalid Zendesk comment author");
    const authorObject = author as Record<string, unknown>;
    const authorId = normalizeExternalId(authorObject.id, "author");
    const rawRole = typeof authorObject.role === "string" ? authorObject.role.trim().toLowerCase() : "unknown";
    const role = (["end-user", "agent", "admin", "system"] as const).includes(rawRole as any) ? rawRole as "end-user" | "agent" | "admin" | "system" : "unknown";
    const name = typeof authorObject.name === "string" && authorObject.name.trim() ? authorObject.name.trim().slice(0, 200) : undefined;
    const email = typeof authorObject.email === "string" && /^\S+@\S+\.\S+$/.test(authorObject.email.trim()) ? authorObject.email.trim().toLowerCase().slice(0, 254) : undefined;
    const createdAt = typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) ? new Date(value.createdAt).toISOString() : undefined;
    return { eventType: "ticket.comment.created", ticket: { id }, comment: { id: commentId, body, public: value.public, createdAt, author: { id: authorId, name, email, role } } };
  }

  throw new Error("Unsupported Zendesk webhook event");
}

function localStatus(status: string | undefined) {
  if (!status) return undefined;
  if (status === "pending" || status === "hold") return "pending";
  if (status === "solved" || status === "closed") return "resolved";
  return "open";
}

export class IntegrationInboundService {
  static async verifyAndEnqueue(data: {
    organizationId: string;
    connectionId: string;
    signature: string;
    timestamp: string;
    invocationId: string;
    rawBody: Buffer;
    payload: unknown;
  }) {
    if (!/^[0-9a-f-]{36}$/i.test(data.organizationId) || !/^[0-9a-f-]{36}$/i.test(data.connectionId)) throw new Error("Invalid inbound integration route");
    if (!data.signature || data.signature.length > 512 || !data.timestamp || data.timestamp.length > 100) throw new Error("Missing Zendesk webhook signature");
    if (!data.invocationId || data.invocationId.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(data.invocationId)) throw new Error("Invalid Zendesk webhook invocation id");
    if (!Buffer.isBuffer(data.rawBody) || data.rawBody.length === 0 || data.rawBody.length > 256 * 1024) throw new Error("Invalid Zendesk webhook body");

    const timestampMs = Date.parse(data.timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_TIMESTAMP_SKEW_MS) throw new Error("Zendesk webhook timestamp is outside the allowed replay window");

    const { secret } = await IntegrationConnectionService.getZendeskWebhookSigningSecret(data.organizationId, data.connectionId);
    const expected = crypto.createHmac("sha256", secret).update(data.timestamp).update(data.rawBody).digest("base64");
    if (!timingSafeStringEqual(data.signature, expected)) throw new Error("Invalid Zendesk webhook signature");

    const payload = normalizeInboundPayload(data.payload);
    const [created] = await db.insert(integrationInboundEvents).values({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      provider: "zendesk",
      invocationId: data.invocationId,
      eventType: payload.eventType,
      externalEntityId: payload.ticket.id,
      payload: payload as unknown as Record<string, unknown>,
      status: "pending",
    }).onConflictDoNothing({ target: [integrationInboundEvents.organizationId, integrationInboundEvents.connectionId, integrationInboundEvents.invocationId] }).returning();
    return { accepted: Boolean(created), duplicate: !created };
  }

  private static async localTicketIdForZendesk(organizationId: string, connectionId: string, externalId: string) {
    const [link] = await db.select({ ticketId: integrationSyncExecutions.entityId })
      .from(integrationSyncExecutions)
      .innerJoin(integrationSyncRules, eq(integrationSyncExecutions.ruleId, integrationSyncRules.id))
      .where(and(
        eq(integrationSyncExecutions.organizationId, organizationId),
        eq(integrationSyncExecutions.externalId, externalId),
        eq(integrationSyncExecutions.status, "succeeded"),
        isNotNull(integrationSyncExecutions.externalId),
        eq(integrationSyncRules.organizationId, organizationId),
        eq(integrationSyncRules.connectionId, connectionId),
        eq(integrationSyncRules.eventType, "ticket.created"),
        eq(integrationSyncRules.action, "zendesk.create_ticket"),
      ))
      .orderBy(desc(integrationSyncExecutions.updatedAt))
      .limit(1);
    return link?.ticketId;
  }

  private static async ingestZendeskComment(organizationId: string, connectionId: string, ticketId: string, payload: ZendeskCommentCreatedPayload) {
    if (payload.comment.author.role !== "end-user") return "ignored" as const;

    const [actor] = await db.insert(externalActors).values({
      organizationId,
      connectionId,
      provider: "zendesk",
      externalId: payload.comment.author.id,
      role: payload.comment.author.role,
      displayName: payload.comment.author.name,
      email: payload.comment.author.email,
      metadata: { source: "zendesk_webhook" },
    }).onConflictDoUpdate({
      target: [externalActors.organizationId, externalActors.connectionId, externalActors.externalId],
      set: {
        role: payload.comment.author.role,
        displayName: payload.comment.author.name,
        email: payload.comment.author.email,
        updatedAt: new Date(),
      },
    }).returning();

    const [message] = await db.insert(externalTicketMessages).values({
      organizationId,
      ticketId,
      connectionId,
      actorId: actor.id,
      provider: "zendesk",
      externalMessageId: payload.comment.id,
      direction: "inbound",
      visibility: payload.comment.public ? "public" : "internal",
      content: payload.comment.body,
      providerCreatedAt: payload.comment.createdAt ? new Date(payload.comment.createdAt) : undefined,
      metadata: { source: "zendesk_webhook" },
    }).onConflictDoNothing({ target: [externalTicketMessages.organizationId, externalTicketMessages.connectionId, externalTicketMessages.externalMessageId] }).returning();

    return message ? "succeeded" as const : "ignored" as const;
  }

  static async processPending(organizationId: string, limit = 25) {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
    const candidates = await db.select().from(integrationInboundEvents).where(and(
      eq(integrationInboundEvents.organizationId, organizationId),
      or(eq(integrationInboundEvents.status, "pending"), and(eq(integrationInboundEvents.status, "processing"), lt(integrationInboundEvents.updatedAt, staleBefore))),
    )).orderBy(integrationInboundEvents.createdAt).limit(limit);

    let succeeded = 0;
    let ignored = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const [claimed] = await db.update(integrationInboundEvents).set({ status: "processing", updatedAt: new Date() }).where(and(
        eq(integrationInboundEvents.organizationId, organizationId),
        eq(integrationInboundEvents.id, candidate.id),
        or(eq(integrationInboundEvents.status, "pending"), and(eq(integrationInboundEvents.status, "processing"), lt(integrationInboundEvents.updatedAt, staleBefore))),
      )).returning();
      if (!claimed) continue;

      try {
        if (claimed.provider !== "zendesk" || !claimed.externalEntityId) throw new Error("Unsupported inbound integration event");
        const localTicketId = await this.localTicketIdForZendesk(organizationId, claimed.connectionId, claimed.externalEntityId);
        if (!localTicketId) {
          await db.update(integrationInboundEvents).set({ status: "ignored", error: "No linked local ticket", updatedAt: new Date() })
            .where(and(eq(integrationInboundEvents.organizationId, organizationId), eq(integrationInboundEvents.id, claimed.id)));
          ignored += 1;
          continue;
        }

        const payload = normalizeInboundPayload(claimed.payload);
        if (payload.eventType === "ticket.comment.created") {
          const result = await this.ingestZendeskComment(organizationId, claimed.connectionId, localTicketId, payload);
          await db.update(integrationInboundEvents).set({ status: result, error: null, updatedAt: new Date() })
            .where(and(eq(integrationInboundEvents.organizationId, organizationId), eq(integrationInboundEvents.id, claimed.id)));
          if (result === "succeeded") succeeded += 1;
          else ignored += 1;
          continue;
        }

        const [current] = await db.select({ status: tickets.status, priority: tickets.priority }).from(tickets)
          .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, localTicketId))).limit(1);
        if (!current) throw new Error("Linked local ticket not found");
        const desiredStatus = localStatus(payload.ticket.status);
        const desiredPriority = payload.ticket.priority;
        const status = desiredStatus && desiredStatus !== current.status ? desiredStatus : undefined;
        const priority = desiredPriority && desiredPriority !== current.priority ? desiredPriority : undefined;
        if (!status && !priority) {
          await db.update(integrationInboundEvents).set({ status: "ignored", error: null, updatedAt: new Date() })
            .where(and(eq(integrationInboundEvents.organizationId, organizationId), eq(integrationInboundEvents.id, claimed.id)));
          ignored += 1;
          continue;
        }

        await TicketService.updateTicket({ organizationId, ticketId: localTicketId, status, priority, eventSource: "zendesk" });
        await db.update(integrationInboundEvents).set({ status: "succeeded", error: null, updatedAt: new Date() })
          .where(and(eq(integrationInboundEvents.organizationId, organizationId), eq(integrationInboundEvents.id, claimed.id)));
        succeeded += 1;
      } catch (error) {
        await db.update(integrationInboundEvents).set({ status: "failed", error: (error as Error).message.slice(0, 1000), updatedAt: new Date() })
          .where(and(eq(integrationInboundEvents.organizationId, organizationId), eq(integrationInboundEvents.id, claimed.id)));
        failed += 1;
      }
    }
    return { processed: candidates.length, succeeded, ignored, failed };
  }

  static async sweepAll(shouldStop?: () => boolean) {
    const tenantRows = await db.select({ id: organizations.id }).from(organizations).limit(10_000);
    let processed = 0;
    let succeeded = 0;
    let ignored = 0;
    let failed = 0;
    for (const tenant of tenantRows) {
      if (shouldStop?.()) break;
      const result = await withDatabaseTenantContext(async () => {
        setDatabaseTenant(tenant.id);
        return this.processPending(tenant.id);
      });
      processed += result.processed;
      succeeded += result.succeeded;
      ignored += result.ignored;
      failed += result.failed;
    }
    return { processed, succeeded, ignored, failed };
  }
}
