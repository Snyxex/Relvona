import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema.js";
import { bookings } from "./extendedCustomerExperienceSchema.js";

export const bookingCalendarSync = pgTable("booking_calendar_sync", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }).notNull(),
  action: text("action").notNull(),
  status: text("status").default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at"),
  lastAttemptAt: timestamp("last_attempt_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  bookingUnique: uniqueIndex("booking_calendar_sync_booking_unique").on(table.organizationId, table.bookingId),
  pendingIdx: index("booking_calendar_sync_pending_idx").on(table.organizationId, table.status, table.nextAttemptAt),
}));
