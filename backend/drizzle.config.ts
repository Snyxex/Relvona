import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/platformRoles.ts", "./src/db/extendedCustomerExperienceSchema.ts", "./src/db/actionExecutionSchema.ts", "./src/db/calendarOAuthSchema.ts", "./src/db/conversationSchedulingSchema.ts", "./src/db/supportAnalyticsSchema.ts", "./src/db/knowledgeCollectionsSchema.ts", "./src/db/webhookSchema.ts", "./src/db/assistantVersionSchema.ts", "./src/db/integrationConnectionSchema.ts", "./src/db/integrationSyncSchema.ts", "./src/db/integrationInboundSchema.ts", "./src/db/externalTicketMessageSchema.ts", "./src/db/bookingCalendarSyncSchema.ts", "./src/db/mailServerSchema.ts", "./src/db/employeeDirectorySchema.ts", "./src/db/notificationSchema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL || "postgres://postgres:postgrespassword@localhost:5432/ai_support_db",
  },
});
