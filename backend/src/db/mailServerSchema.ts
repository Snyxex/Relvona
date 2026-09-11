import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema.js";

export const mailServerSettings = pgTable("mail_server_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  host: text("host"),
  port: integer("port").default(587).notNull(),
  security: text("security").default("starttls").notNull(),
  username: text("username"),
  passwordEncrypted: text("password_encrypted"),
  fromEmail: text("from_email"),
  fromName: text("from_name").default("Relvona").notNull(),
  replyTo: text("reply_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  organizationUnique: uniqueIndex("mail_server_settings_org_unique").on(table.organizationId),
}));
