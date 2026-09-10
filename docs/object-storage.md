# Object storage

All binary file access goes through the provider-neutral `ObjectStorage` boundary and the tenant-aware `FileObjectService`. Business code never accepts a bucket name or storage key from a request. PostgreSQL stores metadata and object references; RustFS stores the file bytes; pgvector continues to store searchable chunks and embeddings.

## Providers

`OBJECT_STORAGE_PROVIDER=rustfs` is the default self-hosted deployment target. RustFS is accessed through the AWS SDK v3-compatible `S3CompatibleObjectStorageProvider`, so no RustFS-specific API leaks into knowledge, ticket, conversation, or ingestion services. `OBJECT_STORAGE_PROVIDER=s3` uses the same adapter for another S3-compatible service. `OBJECT_STORAGE_PROVIDER=filesystem` remains available for development only and is rejected in normal production configuration.

The S3-compatible adapter validates every application-owned key, uses tenant-prefixed object paths, reports storage metrics, retries bounded failures, supports presigned PUT/GET URLs, and performs a bucket readiness check before operations.

## RustFS endpoints

Two endpoint concepts are intentionally separated:

- `OBJECT_STORAGE_ENDPOINT` is the private endpoint used by backend and worker processes, for example `http://rustfs:9000` inside the isolated Docker `data` network.
- `OBJECT_STORAGE_PUBLIC_ENDPOINT` is used only when generating presigned URLs returned to browsers. In production it must be an HTTPS address that resolves for the end user, for example `https://objects.example.com`.

Never return the internal Docker hostname in a browser URL. The public endpoint must route to the same RustFS S3 API and preserve the signed request host/path. If browsers upload directly, configure the reverse proxy/RustFS CORS policy to permit the dashboard origin and the required `PUT`, `GET`, `HEAD` methods and `Content-Type` header.

## Configuration

Typical self-hosted values are:

```env
OBJECT_STORAGE_ENABLED=true
OBJECT_STORAGE_PROVIDER=rustfs
OBJECT_STORAGE_ENDPOINT=http://rustfs:9000
OBJECT_STORAGE_PUBLIC_ENDPOINT=https://objects.example.com
OBJECT_STORAGE_BUCKET=supportai
OBJECT_STORAGE_ACCESS_KEY=SUPPORTAIPROD
OBJECT_STORAGE_SECRET_KEY=replace-with-a-long-random-secret
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_AUTO_CREATE_BUCKET=true
OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS=300
OBJECT_STORAGE_CONNECT_TIMEOUT_MS=5000
OBJECT_STORAGE_REQUEST_TIMEOUT_MS=30000
OBJECT_STORAGE_MAX_RETRIES=3
```

`OBJECT_STORAGE_ALLOW_INSECURE_HTTP=true` may be used for the private internal endpoint in a trusted isolated network. It does not permit an insecure `OBJECT_STORAGE_PUBLIC_ENDPOINT`; public presigned URLs require HTTPS in production.

With `OBJECT_STORAGE_AUTO_CREATE_BUCKET=true`, backend/worker readiness creates a missing bucket once and verifies it with `HEAD Bucket`. Disable automatic creation when infrastructure provisioning owns buckets explicitly.

## Object lifecycle

Upload intents create a `file_objects` row in `PENDING_UPLOAD` state with an expiration time and a server-generated tenant-prefixed key. Direct uploads are finalized only after the backend performs `HEAD Object`, validates size and content type, reads and scans the actual file, calculates SHA-256, and transitions the object to its usable state.

Knowledge raw files use `UPLOADED`. Validated attachments and processed artifacts use `READY`. Reads accept only usable states and always include the organization ID in the database lookup. Failed, expired, abandoned, and stale processing objects are reclaimed by the storage cleanup worker so orphaned RustFS objects do not accumulate indefinitely.

Presigned upload URLs deliberately do not sign an exact `Content-Length`. The configured maximum is a policy limit, not the expected exact file size; the actual size is verified during finalization. Content type remains signed and is verified again against stored metadata and file-security checks.

## Knowledge ingestion

PDF knowledge sources are storage-backed. The compatibility multipart endpoint still accepts a PDF through the backend, validates it and writes it to RustFS. The direct upload API can instead create a presigned upload intent and finalize the uploaded object. Both flows persist only the object reference in ingestion data; BullMQ carries the durable job/reference rather than Base64 file contents.

Extracted/processed text is also stored as an object and referenced by immutable `knowledge_source_revisions`. Document chunks and embeddings remain in PostgreSQL/pgvector.

Legacy PDF queue payloads containing old file paths are rejected and must be uploaded again through the current storage-backed flow.

## Attachments

Conversation and ticket attachments use the same `file_objects` lifecycle. The attachment row stores parent relation, uploader, visibility, original filename, MIME type and size while the bytes remain in RustFS. Tenant authorization is checked before finalization and before download.

## Docker deployments

`docker-compose.local.yml` runs RustFS with its S3 API on `127.0.0.1:9000` and console on `127.0.0.1:9001`. Data persists in `supportai-local-rustfs`. The backend talks to `http://rustfs:9000`, while generated browser URLs use `http://localhost:9000`.

`docker-compose.prod.yml` keeps RustFS exclusively on the internal `data` network, persists `/data` in `rustfsdata`, and disables the console. A separate HTTPS reverse-proxy route must expose the S3 API at the configured `OBJECT_STORAGE_PUBLIC_ENDPOINT` when browser-direct uploads/downloads are enabled.

The bundled single-node Compose setup uses the configured RustFS credentials for the application. Hardened deployments should provision a dedicated least-privilege RustFS identity and manage root/admin credentials independently outside the application configuration.

## Operations and backups

`/health/ready` includes the object-storage health result. Storage metrics include operation counts, failures, duration, uploaded bytes, cleanup activity and signed URL creation.

PostgreSQL and RustFS backups form one logical data set and should be retained/restored to the same recovery point. PostgreSQL contains object metadata and references while RustFS contains the bytes. After a restore, validate active `file_objects.storage_key` entries against RustFS with a bounded HEAD sweep before declaring the restore healthy.
