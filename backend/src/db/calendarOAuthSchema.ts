import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema.js";

export const calendarOAuthStates = pgTable("calendar_oauth_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").notNull(),
  stateHash: text("state_hash").notNull().unique(),
  codeVerifierEncrypted: text("code_verifier_encrypted").notNull(),
  redirectAfter: text("redirect_after"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  calendarOAuthStateIdx: index("calendar_oauth_state_idx").on(table.organizationId, table.userId, table.provider, table.expiresAt),
}));
