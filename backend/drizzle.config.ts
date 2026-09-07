import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/platformRoles.ts", "./src/db/extendedCustomerExperienceSchema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL || "postgres://postgres:postgrespassword@localhost:5432/ai_support_db",
  },
});
