import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./schema.js";

export const PLATFORM_ADMIN_ROLE = "PLATFORM_ADMIN" as const;

/** Global platform authorization. Organization roles remain in organization_members. */
export const platformRoles = pgTable("platform_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userUnique: uniqueIndex("platform_role_user_unique").on(table.userId),
  roleUnique: uniqueIndex("platform_role_name_unique").on(table.role),
}));
