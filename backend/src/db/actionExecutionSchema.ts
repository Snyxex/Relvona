import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, customers, organizations, users } from "./schema.js";

export const actionExecutions = pgTable("action_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  toolId: text("tool_id").notNull(),
  input: jsonb("input").default({}).notNull(),
  status: text("status").default("pending").notNull(),
  riskLevel: text("risk_level").notNull(),
  requiresApproval: boolean("requires_approval").default(true).notNull(),
  requestedByType: text("requested_by_type").default("ai").notNull(),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decisionReason: text("decision_reason"),
  result: jsonb("result"),
  error: text("error"),
  idempotencyKey: text("idempotency_key"),
  expiresAt: timestamp("expires_at"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  actionExecutionOrgIdx: index("action_execution_org_idx").on(table.organizationId, table.status, table.createdAt),
  actionExecutionConversationIdx: index("action_execution_conversation_idx").on(table.organizationId, table.conversationId, table.createdAt),
  actionExecutionIdempotencyUnique: uniqueIndex("action_execution_idempotency_unique").on(table.organizationId, table.toolId, table.idempotencyKey),
}));
