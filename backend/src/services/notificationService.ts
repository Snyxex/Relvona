import { and, desc, eq, gt, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { notificationSettings, notifications } from "../db/notificationSchema.js";
import { bookings, meetingTypes } from "../db/extendedCustomerExperienceSchema.js";
import { organizationMembers, ticketComments, tickets } from "../db/schema.js";

const DEFAULT_BOOKING_REMINDER_MINUTES = 30;
const DEFAULT_TICKET_IDLE_MINUTES = 120;

function clampMinutes(value: number, fallback: number) {
  return Number.isInteger(value) && value >= 5 && value <= 10080 ? value : fallback;
}

export class NotificationService {
  static async settings(organizationId: string) {
    const [existing] = await db.select().from(notificationSettings).where(eq(notificationSettings.organizationId, organizationId)).limit(1);
    if (existing) return existing;
    const [created] = await db.insert(notificationSettings).values({ organizationId }).returning();
    return created;
  }

  static async updateSettings(organizationId: string, input: Record<string, unknown>) {
    await this.settings(organizationId);
    const patch = {
      bookingReminderEnabled: input.bookingReminderEnabled !== false,
      bookingReminderMinutes: clampMinutes(Number(input.bookingReminderMinutes), DEFAULT_BOOKING_REMINDER_MINUTES),
      ticketIdleEnabled: input.ticketIdleEnabled !== false,
      ticketIdleMinutes: clampMinutes(Number(input.ticketIdleMinutes), DEFAULT_TICKET_IDLE_MINUTES),
      updatedAt: new Date(),
    };
    const [updated] = await db.update(notificationSettings).set(patch).where(eq(notificationSettings.organizationId, organizationId)).returning();
    return updated;
  }

  static async listForUser(organizationId: string, userId: string, limit = 30) {
    const rows = await db.select().from(notifications).where(and(
      eq(notifications.organizationId, organizationId),
      eq(notifications.recipientUserId, userId),
    )).orderBy(desc(notifications.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
    return { unread: rows.filter((row) => !row.readAt).length, notifications: rows };
  }

  static async markRead(organizationId: string, userId: string, id: string) {
    const [updated] = await db.update(notifications).set({ readAt: new Date() }).where(and(
      eq(notifications.organizationId, organizationId),
      eq(notifications.recipientUserId, userId),
      eq(notifications.id, id),
      isNull(notifications.readAt),
    )).returning();
    return updated || null;
  }

  static async markAllRead(organizationId: string, userId: string) {
    await db.update(notifications).set({ readAt: new Date() }).where(and(
      eq(notifications.organizationId, organizationId),
      eq(notifications.recipientUserId, userId),
      isNull(notifications.readAt),
    ));
  }

  private static async fallbackRecipients(organizationId: string) {
    return db.select({ userId: organizationMembers.userId }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.status, "active"),
      inArray(organizationMembers.role, ["owner", "admin"]),
    ));
  }

  private static async createForRecipients(data: {
    organizationId: string;
    recipientUserIds: string[];
    type: string;
    severity: string;
    title: string;
    message: string;
    resourceType: string;
    resourceId: string;
    dedupeKey: string;
  }) {
    const recipients = [...new Set(data.recipientUserIds)].filter(Boolean);
    let created = 0;
    for (const recipientUserId of recipients) {
      const rows = await db.insert(notifications).values({
        organizationId: data.organizationId,
        recipientUserId,
        type: data.type,
        severity: data.severity,
        title: data.title,
        message: data.message,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        dedupeKey: data.dedupeKey,
      }).onConflictDoNothing({ target: [notifications.organizationId, notifications.recipientUserId, notifications.dedupeKey] }).returning({ id: notifications.id });
      created += rows.length;
    }
    return created;
  }

  static async sweepOrganization(organizationId: string) {
    const settings = await this.settings(organizationId);
    const now = new Date();
    let bookingNotifications = 0;
    let ticketNotifications = 0;

    if (settings.bookingReminderEnabled) {
      const until = new Date(now.getTime() + settings.bookingReminderMinutes * 60_000);
      const dueBookings = await db.select({
        bookingId: bookings.id,
        startsAt: bookings.startsAt,
        assignedUserId: bookings.assignedUserId,
        timezone: bookings.timezone,
        meetingName: meetingTypes.name,
      }).from(bookings)
        .innerJoin(meetingTypes, and(eq(meetingTypes.id, bookings.meetingTypeId), eq(meetingTypes.organizationId, organizationId)))
        .where(and(
          eq(bookings.organizationId, organizationId),
          eq(bookings.status, "confirmed"),
          gt(bookings.startsAt, now),
          lte(bookings.startsAt, until),
        )).limit(250);

      const fallback = dueBookings.some((booking) => !booking.assignedUserId) ? await this.fallbackRecipients(organizationId) : [];
      for (const booking of dueBookings) {
        const recipientIds = booking.assignedUserId ? [booking.assignedUserId] : fallback.map((item) => item.userId);
        const minutes = Math.max(1, Math.ceil((booking.startsAt.getTime() - now.getTime()) / 60_000));
        bookingNotifications += await this.createForRecipients({
          organizationId,
          recipientUserIds: recipientIds,
          type: "booking.upcoming",
          severity: minutes <= 10 ? "warning" : "info",
          title: `Termin in ${minutes} Minuten`,
          message: `${booking.meetingName} beginnt bald (${booking.timezone}).`,
          resourceType: "booking",
          resourceId: booking.bookingId,
          dedupeKey: `booking:${booking.bookingId}:${booking.startsAt.toISOString()}`,
        });
      }
    }

    if (settings.ticketIdleEnabled) {
      const idleBefore = new Date(now.getTime() - settings.ticketIdleMinutes * 60_000);
      const candidateTickets = await db.select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        assignedAgentId: tickets.assignedAgentId,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
        lastPublicReplyAt: sql<Date | null>`max(${ticketComments.createdAt}) filter (where ${ticketComments.isInternal} = false)`,
      }).from(tickets)
        .leftJoin(ticketComments, and(eq(ticketComments.ticketId, tickets.id), eq(ticketComments.organizationId, organizationId)))
        .where(and(
          eq(tickets.organizationId, organizationId),
          notInArray(tickets.status, ["pending", "resolved", "closed"]),
          lte(tickets.updatedAt, idleBefore),
        ))
        .groupBy(tickets.id)
        .limit(250);

      const fallback = candidateTickets.some((ticket) => !ticket.assignedAgentId) ? await this.fallbackRecipients(organizationId) : [];
      for (const ticket of candidateTickets) {
        const lastActivity = ticket.lastPublicReplyAt || ticket.createdAt;
        if (lastActivity > idleBefore) continue;
        const recipientIds = ticket.assignedAgentId ? [ticket.assignedAgentId] : fallback.map((item) => item.userId);
        const idleMinutes = Math.max(settings.ticketIdleMinutes, Math.floor((now.getTime() - lastActivity.getTime()) / 60_000));
        ticketNotifications += await this.createForRecipients({
          organizationId,
          recipientUserIds: recipientIds,
          type: "ticket.idle",
          severity: "warning",
          title: `Ticket #${ticket.ticketNumber} wartet`,
          message: `Seit ${idleMinutes} Minuten gab es keine öffentliche Mitarbeiterantwort: ${ticket.subject}`,
          resourceType: "ticket",
          resourceId: ticket.id,
          dedupeKey: `ticket:${ticket.id}:idle:${lastActivity.toISOString()}`,
        });
      }
    }

    return { bookingNotifications, ticketNotifications };
  }
}
