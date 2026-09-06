import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";

const configuredOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
const betterAuthSecret = process.env.BETTER_AUTH_SECRET;
if (process.env.NODE_ENV === "production" && (!betterAuthSecret || betterAuthSecret.length < 32)) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters in production");

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: { ...schema, user: schema.users, session: schema.authSessions, account: schema.authAccounts, verification: schema.authVerifications }, transaction: true }),
  secret: betterAuthSecret || "development-only-better-auth-secret-do-not-use-in-production",
  baseURL: process.env.BETTER_AUTH_URL || process.env.APP_PUBLIC_URL || "http://localhost:8080",
  trustedOrigins: configuredOrigins,
  user: { modelName: "users", fields: { emailVerified: "emailVerified", image: "avatarUrl" } },
  session: { modelName: "authSessions" },
  account: { modelName: "authAccounts" },
  verification: { modelName: "authVerifications" },
  emailAndPassword: {
    enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128,
    // Existing accounts already use bcrypt. Keeping bcrypt here permits an
    // in-place migration without changing user IDs or weakening passwords.
    password: { hash: async (password) => bcrypt.hash(password, 12), verify: async ({ hash, password }) => bcrypt.compare(password, hash) },
    revokeSessionsOnPasswordReset: true,
  },
  advanced: { cookiePrefix: "supportai", useSecureCookies: process.env.NODE_ENV === "production" },
});
