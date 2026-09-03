const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
};

/** Validate only deployment invariants; tenant provider credentials remain optional. */
export function validateRuntimeConfiguration() {
  positiveInteger("PORT", 8080);
  positiveInteger("DATABASE_POOL_MAX", 10);
  positiveInteger("AI_REQUEST_TIMEOUT_MS", 30_000);
  positiveInteger("HTTP_REQUEST_TIMEOUT_MS", 65_000);
  positiveInteger("SHUTDOWN_TIMEOUT_MS", 30_000);
  if (process.env.NODE_ENV !== "production") return;
  const required = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET_CURRENT", "ENCRYPTION_SECRET_CURRENT", "CORS_ORIGIN", "WIDGET_SESSION_SECRET", "METRICS_TOKEN"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(", ")}`);
  if (process.env.CORS_ORIGIN!.split(",").some((origin) => origin.trim() === "*")) throw new Error("CORS_ORIGIN must not contain '*' in production");
}
