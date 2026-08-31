import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgrespassword@localhost:5432/ai_support_db",
});

export const db = drizzle(pool, { schema });
