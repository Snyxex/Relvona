import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations, organizations, users } from "./schema.js";
import { meetingTypes } from "./extendedCustomerExperienceSchema.js";

export const conversationSchedulingStates = pgTable("conversation_scheduling_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull().unique(),
  meetingTypeId: uuid("meeting_type_id").references(() => meetingTypes.id, { onDelete: "set null" }),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  state: text("state").default("idle").notNull(), // idle | offered | awaiting_contact | approval_pending | booked | cancelled
  offeredSlots: jsonb("offered_slots").default([]).notNull(),
  selectedStartsAt: timestamp("selected_starts_at"),
  selectedTimezone: text("selected_timezone"),
  actionExecutionId: uuid("action_execution_id"),
  bookingId: uuid("booking_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  conversationSchedulingIdx: index("conversation_scheduling_idx").on(table.organizationId, table.conversationId, table.state),
}));
