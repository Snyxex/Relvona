# Object storage

All file access goes through `ObjectStorage` and server-owned `FileObjectService`. Browser and queue code never receive arbitrary bucket names or storage keys.

`OBJECT_STORAGE_PROVIDER=s3` selects `S3CompatibleObjectStorageProvider`, which uses standard S3/SigV4 and is therefore compatible with RustFS without exposing any RustFS types to business code. Required production configuration is `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS`, `OBJECT_STORAGE_CONNECT_TIMEOUT_MS`, `OBJECT_STORAGE_REQUEST_TIMEOUT_MS`, and `OBJECT_STORAGE_MAX_RETRIES`. Production fails closed if a required S3 value is missing or endpoint TLS is not enabled (unless explicitly opted out for a private deployment).

`OBJECT_STORAGE_PROVIDER=filesystem` remains a real local/self-hosted adapter for development. Set `OBJECT_STORAGE_LOCAL_ROOT` to choose its private directory. It cannot be used in production. Buckets are intentionally pre-provisioned and only health-checked; the application does not create infrastructure automatically.

The PDF knowledge flow is storage-backed: the backend validates the multipart upload, creates a tenant-prefixed server key, writes the object and SHA-256 metadata, and persists only `objectId` in ingestion input. BullMQ continues to carry only the existing job reference. Downloads are authorized by source and organization before the object is streamed; no public URL or key-based download API exists.

The additive `ensureIngestionSchema.ts` migration creates `file_objects` and immutable `knowledge_source_revisions`. Run it before enabling RLS on an existing database. Legacy PDF payloads already in Redis are rejected rather than being re-published with Base64; re-upload them through the authenticated endpoint.

For local RustFS, the Compose service only binds S3/console ports to loopback and persists `/data` in `supportai-local-rustfs`. Put non-default credentials and an already-created bucket in `.env.local`; do not commit them. In production, use a private TLS endpoint and a least-privilege RustFS IAM/service account. PostgreSQL and RustFS backups must be retained and restored together; after restore, validate every active `file_objects.storage_key` with a bounded DB-driven HEAD sweep.
