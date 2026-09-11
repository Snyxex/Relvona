import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema.js";

export const notificationSettings = pgTable("notification_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull().unique(),
  bookingReminderEnabled: boolean("booking_reminder_enabled").default(true).notNull(),
  bookingReminderMinutes: integer("booking_reminder_minutes").default(30).notNull(),
  ticketIdleEnabled: boolean("ticket_idle_enabled").default(true).notNull(),
  ticketIdleMinutes: integer("ticket_idle_minutes").default(120).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  severity: text("severity").default("info").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  resourceType: text("resource_type"),
  resourceId: uuid("resource_id"),
  dedupeKey: text("dedupe_key").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  recipientIdx: index("notification_recipient_idx").on(table.organizationId, table.recipientUserId, table.readAt, table.createdAt),
  dedupeUnique: uniqueIndex("notification_dedupe_unique").on(table.organizationId, table.recipientUserId, table.dedupeKey),
}));
