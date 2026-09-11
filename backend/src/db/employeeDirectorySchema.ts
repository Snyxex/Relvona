import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema.js";

export const employeeDirectory = pgTable("employee_directory", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  department: text("department"),
  jobTitle: text("job_title"),
  skills: jsonb("skills").default([]).notNull(),
  notes: text("notes"),
  aiVisible: boolean("ai_visible").default(true).notNull(),
  exposeEmailToCustomer: boolean("expose_email_to_customer").default(false).notNull(),
  exposePhoneToCustomer: boolean("expose_phone_to_customer").default(false).notNull(),
  allowDirectHandoff: boolean("allow_direct_handoff").default(false).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgNameIdx: index("employee_directory_org_name_idx").on(table.organizationId, table.displayName),
  orgUserUnique: uniqueIndex("employee_directory_org_user_unique").on(table.organizationId, table.userId),
}));
