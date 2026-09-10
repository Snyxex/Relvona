import assert from "node:assert/strict";
import { objectStorageConfig } from "../config/objectStorage.js";

const names = [
  "NODE_ENV",
  "OBJECT_STORAGE_ENABLED",
  "OBJECT_STORAGE_PROVIDER",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_PUBLIC_ENDPOINT",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_FORCE_PATH_STYLE",
  "OBJECT_STORAGE_AUTO_CREATE_BUCKET",
  "OBJECT_STORAGE_ALLOW_INSECURE_HTTP",
  "OBJECT_STORAGE_CORS_ALLOWED_ORIGINS",
] as const;

const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));

function restore() {
  for (const name of names) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

try {
  process.env.NODE_ENV = "development";
  process.env.OBJECT_STORAGE_PROVIDER = "rustfs";
  process.env.OBJECT_STORAGE_ENDPOINT = "http://127.0.0.1:9000";
  process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT = "http://localhost:9000";
  process.env.OBJECT_STORAGE_BUCKET = "supportai";
  process.env.OBJECT_STORAGE_ACCESS_KEY = "SUPPORTAITEST";
  process.env.OBJECT_STORAGE_SECRET_KEY = "test-secret-with-sufficient-entropy";
  process.env.OBJECT_STORAGE_AUTO_CREATE_BUCKET = "true";
  process.env.OBJECT_STORAGE_CORS_ALLOWED_ORIGINS = "http://localhost:3000,https://dashboard.example.test,http://localhost:3000";

  const rustfs = objectStorageConfig();
  assert.equal(rustfs.provider, "rustfs");
  assert.equal(rustfs.publicEndpoint, "http://localhost:9000");
  assert.equal(rustfs.autoCreateBucket, true);
  assert.equal(rustfs.forcePathStyle, true);
  assert.deepEqual(rustfs.corsAllowedOrigins, ["http://localhost:3000", "https://dashboard.example.test"]);

  process.env.OBJECT_STORAGE_CORS_ALLOWED_ORIGINS = "https://dashboard.example.test/path";
  assert.throws(() => objectStorageConfig(), /CORS_ALLOWED_ORIGINS/);

  process.env.NODE_ENV = "production";
  process.env.OBJECT_STORAGE_ALLOW_INSECURE_HTTP = "true";
  process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT = "https://objects.example.test";
  process.env.OBJECT_STORAGE_CORS_ALLOWED_ORIGINS = "https://dashboard.example.test";
  assert.equal(objectStorageConfig().provider, "rustfs");

  process.env.OBJECT_STORAGE_CORS_ALLOWED_ORIGINS = "http://dashboard.example.test";
  assert.throws(() => objectStorageConfig(), /CORS_ALLOWED_ORIGINS must use HTTPS in production/);

  process.env.OBJECT_STORAGE_CORS_ALLOWED_ORIGINS = "https://dashboard.example.test";
  process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT = "http://objects.example.test";
  assert.throws(() => objectStorageConfig(), /OBJECT_STORAGE_PUBLIC_ENDPOINT must use HTTPS in production/);

  process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT = "https://objects.example.test";
  delete process.env.OBJECT_STORAGE_ALLOW_INSECURE_HTTP;
  assert.throws(() => objectStorageConfig(), /OBJECT_STORAGE_ENDPOINT must use HTTPS in production/);

  process.env.NODE_ENV = "development";
  process.env.OBJECT_STORAGE_PROVIDER = "invalid";
  assert.throws(() => objectStorageConfig(), /filesystem, s3 or rustfs/);

  console.log("Object storage configuration tests passed.");
} finally {
  restore();
}
