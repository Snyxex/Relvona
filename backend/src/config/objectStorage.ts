export type ObjectStorageConfig = { enabled: boolean; provider: "filesystem" | "s3"; endpoint?: string; region: string; bucket?: string; accessKey?: string; secretKey?: string; forcePathStyle: boolean; signedUrlTtlSeconds: number; connectTimeoutMs: number; requestTimeoutMs: number; maxRetries: number };
const positive = (name: string, fallback: number) => { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`); return value; };
export function objectStorageConfig(): ObjectStorageConfig {
  const enabled = process.env.OBJECT_STORAGE_ENABLED !== "false";
  const provider = (process.env.OBJECT_STORAGE_PROVIDER || "filesystem").toLowerCase();
  if (provider !== "filesystem" && provider !== "s3") throw new Error("OBJECT_STORAGE_PROVIDER must be filesystem or s3");
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  const config: ObjectStorageConfig = { enabled, provider, endpoint, region: process.env.OBJECT_STORAGE_REGION || "us-east-1", bucket: process.env.OBJECT_STORAGE_BUCKET, accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY, secretKey: process.env.OBJECT_STORAGE_SECRET_KEY, forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false", signedUrlTtlSeconds: positive("OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS", 300), connectTimeoutMs: positive("OBJECT_STORAGE_CONNECT_TIMEOUT_MS", 5_000), requestTimeoutMs: positive("OBJECT_STORAGE_REQUEST_TIMEOUT_MS", 30_000), maxRetries: positive("OBJECT_STORAGE_MAX_RETRIES", 3) };
  if (config.signedUrlTtlSeconds > 3600) throw new Error("OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS must not exceed 3600");
  if (endpoint) { const url = new URL(endpoint); if (url.username || url.password) throw new Error("OBJECT_STORAGE_ENDPOINT must not contain credentials"); if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && process.env.OBJECT_STORAGE_ALLOW_INSECURE_HTTP !== "true") throw new Error("OBJECT_STORAGE_ENDPOINT must use HTTPS in production"); }
  if (process.env.NODE_ENV === "production" && enabled) {
    if (provider !== "s3") throw new Error("Production object storage requires OBJECT_STORAGE_PROVIDER=s3");
    const missing = [["OBJECT_STORAGE_ENDPOINT", endpoint], ["OBJECT_STORAGE_BUCKET", config.bucket], ["OBJECT_STORAGE_ACCESS_KEY", config.accessKey], ["OBJECT_STORAGE_SECRET_KEY", config.secretKey]].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Missing required object storage configuration: ${missing.join(", ")}`);
  }
  return config;
}
