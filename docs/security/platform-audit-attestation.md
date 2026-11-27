# Independently signed platform audit checkpoints

This extends the global event stream introduced by PR #78 with **off-database
tamper evidence**. It does not turn PostgreSQL into immutable storage.

## Threat model

A database administrator can alter, delete or insert rows, despite the app
role's append-only permissions. A separate attestation host reads the audit
stream, hashes **all persisted event fields** using canonical JSON, and
signs a snapshot of event IDs + SHA-256 hashes with Ed25519.

The signing private key must live **outside the database administrator's
trust domain**. The verifier uses a trusted public key supplied independently,
never one read from the database or from the checkpoint itself.

A saved checkpoint detects any deletion or modification of an event it
already covers. It does not inherently authenticate new events created
between snapshots, and it does not prevent database tampering. Save each
new signed checkpoint in a separate immutable/versioned system; do not
rely on a file on the same VPS, a writable S3 bucket, or one latest-only
checkpoint. An administrator controlling both database and attestation
private key can defeat this protection.

## Independent read-only database login

Create a dedicated login using DBA tooling; do not reuse the app user,
a superuser or a database owner. For example, provision an existing
unprivileged \`relvona_audit_reader\` login and set its password securely.
In the normal database migration environment set:

\`DATABASE_PLATFORM_AUDIT_READER_USER=relvona_audit_reader\`

Run the existing \`db:migrate\` procedure after PR #78 has created the
audit table. \`enableRls.ts\` then grants **SELECT only** on
\`platform_audit_logs\`, adds its dedicated forced-RLS SELECT policy,
and refuses inappropriate role membership or inherited write privileges.

The attestor host uses a separate secret:

\`DATABASE_PLATFORM_AUDIT_READ_URL=postgresql://relvona_audit_reader:...@dbhost:5432/...\`

Restrict access at the firewall and database \`pg_hba.conf\`. Protect the
connection string and require TLS for non-local database connections.

## Generate an independent Ed25519 keypair

On an attestation machine not controlled by the database administrators:

\`\`\`sh
umask 077
mkdir -p "$HOME/.config/relvona-audit"
openssl genpkey -algorithm ED25519 -out "$HOME/.config/relvona-audit/private.pem"
openssl pkey -in "$HOME/.config/relvona-audit/private.pem" \
  -pubout -out "$HOME/.config/relvona-audit/public.pem"
\`\`\`

Back up the public key and private key in separate trusted locations.
Never put the private key, checkpoint credential or plaintext audit rows
in GitHub, application source, or a regular database backup.

## Create and validate checkpoints

Run from a compiled backend package on the independent attestor host,
after exporting \`DATABASE_PLATFORM_AUDIT_READ_URL\` through a secret
manager. The command reads audit rows but writes nothing to the database.

The initial checkpoint is an explicit, one-time trust baseline:

\`\`\`sh
node dist/scripts/platformAuditCheckpoint.js create \
  --initial \
  --public-key "$HOME/.config/relvona-audit/public.pem" \
  --private-key "$HOME/.config/relvona-audit/private.pem" \
  --out "checkpoints/platform-audit-000001.json"
\`\`\`

Copy this signed file to external immutable storage **immediately**.
For the next snapshot, supply the already independently archived
previous checkpoint; the command rejects any previously anchored
events that have been changed or removed:

\`\`\`sh
node dist/scripts/platformAuditCheckpoint.js create \
  --previous "checkpoints/platform-audit-000001.json" \
  --public-key "$HOME/.config/relvona-audit/public.pem" \
  --private-key "$HOME/.config/relvona-audit/private.pem" \
  --out "checkpoints/platform-audit-000002.json"
\`\`\`

Verification works using just the public key and the read-only
database account; the signing private key is unnecessary:

\`\`\`sh
node dist/scripts/platformAuditCheckpoint.js verify \
  --checkpoint "checkpoints/platform-audit-000002.json" \
  --previous "checkpoints/platform-audit-000001.json" \
  --public-key "$HOME/.config/relvona-audit/public.pem"
\`\`\`

The verifier exits nonzero on invalid signatures, mismatched predecessor
digests, deleted or edited anchored events. It reports how many **new
unanchored events** have appeared since that snapshot. \`--strict\`
additionally fails when any unanchored events exist.

Files are written with create-only semantics (no overwrite) and
owner-only permissions. Use unique output filenames.

## Operational automation and alerts

Run the checkpoint step every 5–15 minutes from an **independent** host
(e.g. a dedicated n8n/cron runner with its own secrets) and immediately
ship each new checkpoint to an immutable, versioned archive. Trigger
an urgent security alert on any nonzero exit or on unexpected absence
of new checkpoints. Independently run verification against archived
checkpoints. Never accept a new \`--initial\` baseline to silence a
mismatch.

Limitations: the period since the most recent checkpoint is an
unanchored window. A snapshot signer who only observes the database
cannot distinguish valid new events from fabricated ones inserted
**before** signing. Per-event independent signatures or a realtime
external append-only stream are possible future improvements.
Keep historical public keys for rotation; this v1 does not automatically
rotate Ed25519 keys across chained checkpoints.

## Verification

Unit tests cover signature integrity, canonical JSON, changed/deleted
rows, foreign signing keys, duplicates and checkpoint chaining.
Jenkins must still pass backend TypeScript, unit and security suites.
A production-like smoke test should verify database read permissions,
attestor connectivity, archive durability and alert routing.
