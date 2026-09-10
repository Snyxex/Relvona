import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { objectStorageConfig } from "../config/objectStorage.js";
import { metrics } from "../observability/metrics.js";

export type ObjectMetadata = {
  contentType?: string;
  contentLength: number;
  sha256?: string;
  metadata?: Record<string, string>;
};
export type PutObject = ObjectMetadata & { body: Readable | Buffer };

/** Provider boundary. Business services never receive a bucket, endpoint, or arbitrary key from a request. */
export interface ObjectStorage {
  ensureReady(): Promise<void>;
  putObject(key: string, object: PutObject): Promise<void>;
  getObject(key: string): Promise<{ body: Readable; metadata: ObjectMetadata }>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  getObjectMetadata(key: string): Promise<ObjectMetadata>;
  createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  createSignedUploadUrl(key: string, expiresInSeconds: number, metadata: ObjectMetadata): Promise<string>;
  healthCheck(): Promise<"HEALTHY" | "UNAVAILABLE">;
}

function safePath(root: string, key: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(key) || key.includes("..")) {
    throw new Error("Invalid storage key");
  }
  const target = path.resolve(root, key);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Storage key escapes root");
  return target;
}

function isNotFound(error: unknown) {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
}

/** Local development adapter. Production defaults to S3/RustFS instead. */
export class FilesystemObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  async ensureReady() {
    await mkdir(this.root, { recursive: true });
  }

  async putObject(key: string, object: PutObject) {
    const target = safePath(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.uploading`;
    try {
      await pipeline(
        Buffer.isBuffer(object.body) ? Readable.from(object.body) : object.body,
        createWriteStream(temp, { flags: "wx" }),
      );
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async getObject(key: string) {
    const metadata = await this.getObjectMetadata(key);
    return { body: createReadStream(safePath(this.root, key)), metadata };
  }

  async deleteObject(key: string) {
    await rm(safePath(this.root, key), { force: true });
  }

  async objectExists(key: string) {
    try {
      await access(safePath(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadata> {
    const info = await stat(safePath(this.root, key));
    return { contentLength: info.size };
  }

  async createSignedDownloadUrl(): Promise<string> {
    throw new Error("This storage provider does not support direct signed URLs");
  }

  async createSignedUploadUrl(): Promise<string> {
    throw new Error("This storage provider does not support direct signed URLs");
  }

  async healthCheck(): Promise<"HEALTHY" | "UNAVAILABLE"> {
    try {
      await access(this.root);
      return "HEALTHY";
    } catch {
      return "UNAVAILABLE";
    }
  }
}

/** AWS-SDK based adapter used for both generic S3 and RustFS. */
export class S3CompatibleObjectStorageProvider implements ObjectStorage {
  private readonly config = objectStorageConfig();
  private readonly credentials = {
    accessKeyId: this.config.accessKey!,
    secretAccessKey: this.config.secretKey!,
  };
  private readonly requestHandler = new NodeHttpHandler({
    connectionTimeout: this.config.connectTimeoutMs,
    requestTimeout: this.config.requestTimeoutMs,
  });
  private readonly client = new S3Client({
    endpoint: this.config.endpoint,
    region: this.config.region,
    forcePathStyle: this.config.forcePathStyle,
    credentials: this.credentials,
    maxAttempts: this.config.maxRetries,
    requestHandler: this.requestHandler,
  });
  private readonly signingClient = new S3Client({
    endpoint: this.config.publicEndpoint || this.config.endpoint,
    region: this.config.region,
    forcePathStyle: this.config.forcePathStyle,
    credentials: this.credentials,
    maxAttempts: this.config.maxRetries,
    requestHandler: this.requestHandler,
  });
  private readyPromise: Promise<void> | undefined;

  private key(key: string) {
    safePath("/storage-key-validation", key);
    return key;
  }

  private async run<T>(name: string, operation: () => Promise<T>) {
    const started = performance.now();
    try {
      const value = await operation();
      metrics.increment("storage_operations_total", { operation: name });
      return value;
    } catch (error) {
      metrics.increment("storage_operation_errors_total", { operation: name });
      throw error;
    } finally {
      metrics.observe("storage_operation_duration", performance.now() - started, { operation: name });
    }
  }

  private async ensureReadyInternal() {
    try {
      await this.run("head_bucket", () => this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket! })));
      return;
    } catch (error) {
      if (!isNotFound(error) || !this.config.autoCreateBucket) throw error;
    }

    try {
      await this.run("create_bucket", () =>
        this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket! })),
      );
    } catch (createError) {
      // Backend and worker may race on first boot. If the other process created
      // the bucket first, a successful HEAD proves readiness and the conflict is harmless.
      try {
        await this.run("head_bucket", () => this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket! })));
        return;
      } catch {
        throw createError;
      }
    }

    await this.run("head_bucket", () => this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket! })));
  }

  ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = this.ensureReadyInternal().catch((error) => {
        this.readyPromise = undefined;
        throw error;
      });
    }
    return this.readyPromise;
  }

  async putObject(key: string, object: PutObject) {
    await this.ensureReady();
    await this.run("put", () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket!,
          Key: this.key(key),
          Body: object.body,
          ContentType: object.contentType,
          ContentLength: object.contentLength,
          Metadata: object.sha256 ? { sha256: object.sha256 } : undefined,
        }),
      ),
    );
    metrics.increment("storage_upload_bytes_total", {}, object.contentLength);
  }

  async getObject(key: string) {
    await this.ensureReady();
    const response = await this.run("get", () =>
      this.client.send(new GetObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key) })),
    );
    if (!response.Body) throw new Error("Object body missing");
    return {
      body: response.Body as Readable,
      metadata: {
        contentType: response.ContentType,
        contentLength: Number(response.ContentLength || 0),
        sha256: response.Metadata?.sha256,
        metadata: response.Metadata,
      },
    };
  }

  async deleteObject(key: string) {
    await this.ensureReady();
    await this.run("delete", () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key) })),
    );
  }

  async objectExists(key: string) {
    try {
      await this.getObjectMetadata(key);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async getObjectMetadata(key: string) {
    await this.ensureReady();
    const response = await this.run("head", () =>
      this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key) })),
    );
    return {
      contentType: response.ContentType,
      contentLength: Number(response.ContentLength || 0),
      sha256: response.Metadata?.sha256,
      metadata: response.Metadata,
    };
  }

  async createSignedDownloadUrl(key: string, expiresInSeconds: number) {
    await this.ensureReady();
    const url = await getSignedUrl(
      this.signingClient,
      new GetObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key) }),
      { expiresIn: expiresInSeconds },
    );
    metrics.increment("storage_signed_download_urls_total");
    return url;
  }

  async createSignedUploadUrl(key: string, expiresInSeconds: number, metadata: ObjectMetadata) {
    await this.ensureReady();
    // Do not sign Content-Length here. Browser clients cannot reliably control that
    // header and the configured max size is enforced during finalize via HEAD + scan.
    const url = await getSignedUrl(
      this.signingClient,
      new PutObjectCommand({
        Bucket: this.config.bucket!,
        Key: this.key(key),
        ContentType: metadata.contentType,
      }),
      { expiresIn: expiresInSeconds },
    );
    metrics.increment("storage_signed_upload_urls_total");
    return url;
  }

  async healthCheck(): Promise<"HEALTHY" | "UNAVAILABLE"> {
    try {
      await this.ensureReady();
      return "HEALTHY";
    } catch {
      return "UNAVAILABLE";
    }
  }
}

let configuredStorage: ObjectStorage | undefined;
let storageInitialization: Promise<void> | undefined;

export function objectStorage(): ObjectStorage {
  if (configuredStorage) return configuredStorage;
  const config = objectStorageConfig();
  if (!config.enabled) throw new Error("Object storage is disabled");
  if (config.provider === "s3" || config.provider === "rustfs") {
    configuredStorage = new S3CompatibleObjectStorageProvider();
    return configuredStorage;
  }
  if (process.env.NODE_ENV === "production" && process.env.OBJECT_STORAGE_ALLOW_FILESYSTEM !== "true") {
    throw new Error("Filesystem storage is disabled in production; register an ObjectStorage provider");
  }
  configuredStorage = new FilesystemObjectStorage(
    process.env.OBJECT_STORAGE_LOCAL_ROOT || path.resolve(process.cwd(), ".object-storage"),
  );
  return configuredStorage;
}

export function initializeObjectStorage() {
  const config = objectStorageConfig();
  if (!config.enabled) return Promise.resolve();
  if (!storageInitialization) {
    storageInitialization = objectStorage().ensureReady().catch((error) => {
      storageInitialization = undefined;
      throw error;
    });
  }
  return storageInitialization;
}

export function setObjectStorageForTests(storage: ObjectStorage | undefined) {
  configuredStorage = storage;
  storageInitialization = undefined;
}
