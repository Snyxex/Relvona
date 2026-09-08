import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { objectStorageConfig } from "../config/objectStorage.js";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { metrics } from "../observability/metrics.js";

export type ObjectMetadata = { contentType?: string; contentLength: number; sha256?: string; metadata?: Record<string, string> };
export type PutObject = ObjectMetadata & { body: Readable | Buffer };

/** Provider boundary. Business services never receive a bucket, endpoint, or arbitrary key from a request. */
export interface ObjectStorage {
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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const target = path.resolve(root, key);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Storage key escapes root");
  return target;
}

/** A real local/self-hosted adapter; intentionally forbidden in production unless explicitly opted in. */
export class FilesystemObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}
  async putObject(key: string, object: PutObject) {
    const target = safePath(this.root, key); await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.uploading`;
    await pipeline(Buffer.isBuffer(object.body) ? Readable.from(object.body) : object.body, createWriteStream(temp, { flags: "wx" }));
    await rename(temp, target);
  }
  async getObject(key: string) { const metadata = await this.getObjectMetadata(key); return { body: createReadStream(safePath(this.root, key)), metadata }; }
  async deleteObject(key: string) { await rm(safePath(this.root, key), { force: true }); }
  async objectExists(key: string) { try { await access(safePath(this.root, key)); return true; } catch { return false; } }
  async getObjectMetadata(key: string): Promise<ObjectMetadata> { const info = await stat(safePath(this.root, key)); return { contentLength: info.size }; }
  async createSignedDownloadUrl(): Promise<string> { throw new Error("This storage provider does not support direct signed URLs"); }
  async createSignedUploadUrl(): Promise<string> { throw new Error("This storage provider does not support direct signed URLs"); }
  async healthCheck(): Promise<"HEALTHY" | "UNAVAILABLE"> { try { await access(this.root); return "HEALTHY"; } catch { return "UNAVAILABLE"; } }
}

export class S3CompatibleObjectStorageProvider implements ObjectStorage {
  private readonly config = objectStorageConfig();
  private readonly client = new S3Client({ endpoint: this.config.endpoint, region: this.config.region, forcePathStyle: this.config.forcePathStyle, credentials: { accessKeyId: this.config.accessKey!, secretAccessKey: this.config.secretKey! }, maxAttempts: this.config.maxRetries, requestHandler: new NodeHttpHandler({ connectionTimeout: this.config.connectTimeoutMs, requestTimeout: this.config.requestTimeoutMs }) });
  private key(key: string) { safePath("/storage-key-validation", key); return key; }
  private async run<T>(name: string, operation: () => Promise<T>) { const started = performance.now(); try { const value = await operation(); metrics.increment("storage_operations_total", { operation: name }); return value; } catch (error) { metrics.increment("storage_operation_errors_total", { operation: name }); throw error; } finally { metrics.observe("storage_operation_duration", performance.now() - started, { operation: name }); } }
  async putObject(key: string, object: PutObject) { await this.run("put", () => this.client.send(new PutObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key), Body: object.body, ContentType: object.contentType, ContentLength: object.contentLength, Metadata: object.sha256 ? { sha256: object.sha256 } : undefined }))); metrics.increment("storage_upload_bytes_total", {}, object.contentLength); }
  async getObject(key: string) { const response = await this.run("get", () => this.client.send(new GetObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key) }))); if (!response.Body) throw new Error("Object body missing"); return { body: response.Body as Readable, metadata: { contentType: response.ContentType, contentLength: Number(response.ContentLength || 0), sha256: response.Metadata?.sha256, metadata: response.Metadata } }; }
  async deleteObject(key: string) { await this.run("delete", () => this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key) }))); }
  async objectExists(key: string) { try { await this.getObjectMetadata(key); return true; } catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; } }
  async getObjectMetadata(key: string) { const response = await this.run("head", () => this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key) }))); return { contentType: response.ContentType, contentLength: Number(response.ContentLength || 0), sha256: response.Metadata?.sha256, metadata: response.Metadata }; }
  async createSignedDownloadUrl(key: string, expiresInSeconds: number) { const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key) }), { expiresIn: expiresInSeconds }); metrics.increment("storage_signed_download_urls_total"); return url; }
  async createSignedUploadUrl(key: string, expiresInSeconds: number, metadata: ObjectMetadata) { const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.config.bucket!, Key: this.key(key), ContentType: metadata.contentType, ContentLength: metadata.contentLength }), { expiresIn: expiresInSeconds }); metrics.increment("storage_signed_upload_urls_total"); return url; }
  async healthCheck(): Promise<"HEALTHY" | "UNAVAILABLE"> { try { await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket! })); return "HEALTHY"; } catch { return "UNAVAILABLE"; } }
}

let configuredStorage: ObjectStorage | undefined;
export function objectStorage(): ObjectStorage {
  if (configuredStorage) return configuredStorage;
  const config = objectStorageConfig();
  if (!config.enabled) throw new Error("Object storage is disabled");
  if (config.provider === "s3") return configuredStorage = new S3CompatibleObjectStorageProvider();
  if (process.env.NODE_ENV === "production" && process.env.OBJECT_STORAGE_ALLOW_FILESYSTEM !== "true") throw new Error("Filesystem storage is disabled in production; register an ObjectStorage provider");
  configuredStorage = new FilesystemObjectStorage(process.env.OBJECT_STORAGE_LOCAL_ROOT || path.resolve(process.cwd(), ".object-storage"));
  return configuredStorage;
}
export function setObjectStorageForTests(storage: ObjectStorage | undefined) { configuredStorage = storage; }
