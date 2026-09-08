const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
};
import { objectStorageConfig } from "./objectStorage.js";

/** Validate only deployment invariants; tenant provider credentials remain optional. */
export function validateRuntimeConfiguration() {
  positiveInteger("PORT", 8080);
  positiveInteger("DATABASE_POOL_MAX", 10);
  positiveInteger("AI_REQUEST_TIMEOUT_MS", 30_000);
  positiveInteger("HTTP_REQUEST_TIMEOUT_MS", 65_000);
  positiveInteger("SHUTDOWN_TIMEOUT_MS", 30_000);
  objectStorageConfig();
  if (process.env.NODE_ENV !== "production") return;
  const required = ["DATABASE_URL", "REDIS_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "ENCRYPTION_SECRET_CURRENT", "CORS_ORIGIN", "WIDGET_SESSION_SECRET", "VISITOR_IDENTITY_SECRET", "METRICS_TOKEN"];
  if (process.env.CUSTOMER_PORTAL_ENABLED === "true") required.push("PORTAL_TOKEN_SECRET", "PORTAL_PUBLIC_URL", "PORTAL_MAGIC_LINK_WEBHOOK_URL");
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(", ")}`);
  if (process.env.CORS_ORIGIN!.split(",").some((origin) => origin.trim() === "*")) throw new Error("CORS_ORIGIN must not contain '*' in production");
}
