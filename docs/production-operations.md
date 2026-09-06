# Production Operations Runbook

## Deployment and rollback

1. Confirm a successful PostgreSQL backup and the latest restore test before a schema change.
2. Run the locked dependency install, backend/frontend builds, security tests, tenant-isolation test, and production dependency audit in CI.
3. Build immutable images, then run the one-shot `migrate` service. Migrations must be additive (`expand → migrate → contract`) and backward-compatible with the previous API image.
4. Roll out API and worker instances. Wait for `GET /health/ready` to return `200` before sending traffic to an instance.
5. Verify `/health/live`, `/health/ready`, queue failures, HTTP error rate, AI error rate, and a widget message.

Application rollback means redeploying the preceding image. Do not automatically roll back a database migration: restore only from a tested backup or ship a forward-compatible corrective migration. Disable risky functionality with deployment configuration while investigating provider or queue incidents.

## Required configuration

Production requires `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_SECRET_CURRENT`, `WIDGET_SESSION_SECRET`, `CORS_ORIGIN`, and `METRICS_TOKEN`. The application fails fast when these are absent. Set `DATABASE_POOL_MAX` per API replica so the sum of all replicas stays within PostgreSQL capacity; the default is 10.

`AI_REQUEST_TIMEOUT_MS` defaults to 30 seconds and `HTTP_REQUEST_TIMEOUT_MS` to 65 seconds. `AI_MAX_RETRIES` defaults to 2 and retries only transient provider failures with exponential backoff plus jitter. `SHUTDOWN_TIMEOUT_MS` defaults to 30 seconds and must be lower than the platform/container termination grace period.

## Backups and restore

Target an RPO of 24 hours or lower and a tested RTO of four hours or lower; set tighter targets if contractual requirements demand them. PostgreSQL is the system of record. Redis stores reconstructable rate-limit, quota, cache, and queue data; it does not replace PostgreSQL backups.

Create a logical backup:

```sh
pg_dump --format=custom --no-owner "$DATABASE_ADMIN_URL" > supportai-$(date +%F).dump
```

Restore into an isolated database, never directly into the running production database:

```sh
createdb supportai_restore_check
pg_restore --clean --if-exists --no-owner --dbname=supportai_restore_check supportai-YYYY-MM-DD.dump
psql "$RESTORE_CHECK_URL" -c 'SELECT count(*) FROM organizations'
```

Run this restore check at least quarterly. Back up any future object storage separately and verify object-to-database references after restore.

## Health, metrics, and alerts

- `/health/live` only establishes process liveness.
- `/health/ready` checks PostgreSQL and Redis; a `503` removes an instance from traffic.
- `/metrics` is Prometheus text format and requires `Authorization: Bearer $METRICS_TOKEN` in production.

Alert on readiness failures, HTTP 5xx rate, p95 request latency, AI error spikes, queue failed jobs/backlog, PostgreSQL connection exhaustion, Redis errors, container memory/CPU throttling, disk capacity, and failed backups. Baseline SLOs: monthly API availability ≥99.9% (excluding planned maintenance), p95 non-AI API latency <500 ms, and controlled error responses rather than unbounded latency during provider outages.

## Incident actions

| Incident | Immediate action | Recovery verification |
| --- | --- | --- |
| Database unavailable | Remove unready instances from traffic; inspect database availability and connection limits. Do not disable RLS. | `/health/ready` is `200`; tenant-isolation smoke query succeeds. |
| Redis unavailable | Keep instances unready; rate limits, quotas, Socket.IO scale-out, and queues fail closed. | Redis ping, queue enqueue, and readiness succeed. |
| AI provider outage | Check circuit-open/AI error metrics; verify configured fallback or human handoff. Do not expose provider errors to visitors. | Controlled widget response and a successful provider test after cooldown. |
| Queue stuck | Inspect BullMQ failed jobs and worker logs; scale workers only after Redis/PostgreSQL health is confirmed. | Queue depth declines and a test ingestion completes exactly once. |
| High latency/error rate | Halt rollout, use the previous application image, inspect request/trace IDs and dependency health. | Error/latency metrics return to baseline for 15 minutes. |
| Disk full | Stop ingestion/crawling, expand storage, then verify PostgreSQL integrity and queued-job failures. | Free-space alert clears and a database backup succeeds. |

## Routine checks

- Daily: backup success, readiness, queue failures, provider error rate.
- Weekly: dependency/security review and sampled audit-log review.
- Quarterly: restore drill, key rotation exercise, capacity review, and load test of dashboard/widget traffic.
