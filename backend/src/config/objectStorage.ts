export type ObjectStorageConfig = {
  enabled: boolean;
  provider: "filesystem" | "s3" | "rustfs";
  endpoint?: string;
  publicEndpoint?: string;
  region: string;
  bucket?: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle: boolean;
  autoCreateBucket: boolean;
  signedUrlTtlSeconds: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  maxRetries: number;
};

const positive = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

function validateEndpoint(name: string, value: string | undefined, allowInternalHttp: boolean) {
  if (!value) return;
  const url = new URL(value);
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !allowInternalHttp) {
    throw new Error(`${name} must use HTTPS in production`);
  }
}

export function objectStorageConfig(): ObjectStorageConfig {
  const enabled = process.env.OBJECT_STORAGE_ENABLED !== "false";
  const provider = (process.env.OBJECT_STORAGE_PROVIDER || "filesystem").toLowerCase();
  if (provider !== "filesystem" && provider !== "s3" && provider !== "rustfs") {
    throw new Error("OBJECT_STORAGE_PROVIDER must be filesystem, s3 or rustfs");
  }

  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  const publicEndpoint = process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT;
  const allowInsecureInternal = process.env.OBJECT_STORAGE_ALLOW_INSECURE_HTTP === "true";
  const config: ObjectStorageConfig = {
    enabled,
    provider,
    endpoint,
    publicEndpoint,
    region: process.env.OBJECT_STORAGE_REGION || "us-east-1",
    bucket: process.env.OBJECT_STORAGE_BUCKET,
    accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY,
    secretKey: process.env.OBJECT_STORAGE_SECRET_KEY,
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
    autoCreateBucket: process.env.OBJECT_STORAGE_AUTO_CREATE_BUCKET === "true",
    signedUrlTtlSeconds: positive("OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS", 300),
    connectTimeoutMs: positive("OBJECT_STORAGE_CONNECT_TIMEOUT_MS", 5_000),
    requestTimeoutMs: positive("OBJECT_STORAGE_REQUEST_TIMEOUT_MS", 30_000),
    maxRetries: positive("OBJECT_STORAGE_MAX_RETRIES", 3),
  };

  if (config.signedUrlTtlSeconds > 3600) {
    throw new Error("OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS must not exceed 3600");
  }

  // Internal endpoints may use HTTP only after an explicit deployment opt-in,
  // e.g. Docker's isolated data network. Public presigned URLs always require
  // HTTPS in production because they are handed to browsers.
  validateEndpoint("OBJECT_STORAGE_ENDPOINT", endpoint, allowInsecureInternal);
  validateEndpoint("OBJECT_STORAGE_PUBLIC_ENDPOINT", publicEndpoint, false);

  if (process.env.NODE_ENV === "production" && enabled) {
    if (provider === "filesystem") {
      throw new Error("Production object storage requires OBJECT_STORAGE_PROVIDER=s3 or rustfs");
    }
    const missing = [
      ["OBJECT_STORAGE_ENDPOINT", endpoint],
      ["OBJECT_STORAGE_BUCKET", config.bucket],
      ["OBJECT_STORAGE_ACCESS_KEY", config.accessKey],
      ["OBJECT_STORAGE_SECRET_KEY", config.secretKey],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) throw new Error(`Missing required object storage configuration: ${missing.join(", ")}`);
  }

  return config;
}
