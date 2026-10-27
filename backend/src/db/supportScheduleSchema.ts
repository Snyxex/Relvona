import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema.js";

export type WeeklyShift = { day: number; start: string; end: string };

export const supportSchedules = pgTable("support_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  weeklyShifts: jsonb("weekly_shifts").$type<WeeklyShift[]>().notNull().default([]),
  backupUserId: uuid("backup_user_id").references(() => users.id, { onDelete: "set null" }),
  autoRedistribute: boolean("auto_redistribute").notNull().default(true),
  maxOpenTickets: integer("max_open_tickets"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => ({
  uniqueOrgMember: uniqueIndex("support_schedule_org_user_unique").on(t.organizationId, t.userId),
}));

export const supportAbsences = pgTable("support_absences", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  reason: text("reason").notNull().default("vacation"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => ({
  periodIdx: index("support_absence_org_user_period_idx").on(t.organizationId, t.userId, t.startsAt, t.endsAt),
}));
