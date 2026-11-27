import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import {
  assertSignedPlatformAuditCheckpoint,
  comparePlatformAuditCheckpoint,
  createSignedPlatformAuditCheckpoint,
  signedCheckpointDigest,
  type PlatformAuditEvidenceRow,
  type SignedPlatformAuditCheckpoint,
} from "../services/platformAuditAttestation.js";

function usage(): never {
  throw new Error(
    "Usage: platformAuditCheckpoint.js create --out <new-file> " +
      "--public-key <trusted-pem> --private-key <private-pem> " +
      "(--initial | --previous <older-checkpoint>) | " +
      "verify --checkpoint <file> --public-key <trusted-pem> " +
      "[--previous <older-checkpoint>] [--strict]",
  );
}

function parseArguments() {
  const [command, ...argumentsList] = process.argv.slice(2);
  if (command !== "create" && command !== "verify") usage();
  const flags = new Map<string, string>();
  for (let i = 0; i < argumentsList.length; i++) {
    const name = argumentsList[i];
    if (!name.startsWith("--") || flags.has(name)) usage();
    if (name === "--strict" || name === "--initial") {
      flags.set(name, "true");
      continue;
    }
    const value = argumentsList[++i];
    if (!value || value.startsWith("--")) usage();
    flags.set(name, value);
  }
  const allowed =
    command === "create"
      ? ["--out", "--public-key", "--private-key", "--previous", "--initial"]
      : ["--checkpoint", "--public-key", "--previous", "--strict"];
  if ([...flags.keys()].some((name) => !allowed.includes(name))) usage();
  if (!flags.get("--public-key")) usage();
  if (command === "create") {
    if (!flags.get("--out") || !flags.get("--private-key")) usage();
    if (Boolean(flags.has("--initial")) === Boolean(flags.has("--previous"))) {
      usage();
    }
  } else if (!flags.get("--checkpoint")) usage();
  return { command, flags };
}

function readCheckpoint(path: string): SignedPlatformAuditCheckpoint {
  const file = JSON.parse(readFileSync(path, "utf8")) as SignedPlatformAuditCheckpoint;
  return file;
}

async function readEvidence(): Promise<PlatformAuditEvidenceRow[]> {
  // An independently managed SELECT-only database account, never the normal
  // tenant application login and never a production DB administrator password.
  const connectionString = process.env.DATABASE_PLATFORM_AUDIT_READ_URL;
  if (!connectionString) {
    throw new Error("DATABASE_PLATFORM_AUDIT_READ_URL (read-only) is required");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<PlatformAuditEvidenceRow>(
      "SELECT id::text AS id, actor_identity, actor_user_id::text AS actor_user_id, " +
        "action, resource_type, resource_id, metadata, ip_address, user_agent, " +
        "created_at::text AS created_at_text " +
        "FROM public.platform_audit_logs ORDER BY id",
    );
    if (result.rows.length > 200_000) {
      throw new Error("Audit snapshot is too large for v1; use a paged exporter");
    }
    return result.rows;
  } finally {
    await client.end();
  }
}

async function main() {
  const { command, flags } = parseArguments();
  const trustedPublicKey = readFileSync(flags.get("--public-key")!, "utf8");
  const rows = await readEvidence();

  if (command === "create") {
    const privateKey = readFileSync(flags.get("--private-key")!, "utf8");
    const previous = flags.get("--previous")
      ? readCheckpoint(flags.get("--previous")!)
      : undefined;
    const checkpoint = createSignedPlatformAuditCheckpoint(
      rows,
      privateKey,
      previous,
      trustedPublicKey,
    );
    const outputPath = flags.get("--out")!;
    // Never silently replace an earlier signed checkpoint.
    writeFileSync(outputPath, JSON.stringify(checkpoint, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        result: "created",
        entries: checkpoint.body.entryCount,
        checkpointDigest: signedCheckpointDigest(checkpoint),
        out: outputPath,
        previousCheckpointDigest: checkpoint.body.previousCheckpointDigest,
        message: "Transfer checkpoint to independent immutable storage now.",
      }),
    );
    return;
  }

  const checkpoint = readCheckpoint(flags.get("--checkpoint")!);
  assertSignedPlatformAuditCheckpoint(checkpoint, trustedPublicKey);
  if (flags.has("--previous")) {
    const previous = readCheckpoint(flags.get("--previous")!);
    assertSignedPlatformAuditCheckpoint(previous, trustedPublicKey);
    if (checkpoint.body.previousCheckpointDigest !== signedCheckpointDigest(previous)) {
      throw new Error("Checkpoint chain does not match the supplied predecessor");
    }
    const priorComparison = comparePlatformAuditCheckpoint(
      previous,
      trustedPublicKey,
      rows,
    );
    if (priorComparison.missing.length || priorComparison.modified.length) {
      throw new Error("Audit data conflicts with a prior signed checkpoint");
    }
  }
  const result = comparePlatformAuditCheckpoint(
    checkpoint,
    trustedPublicKey,
    rows,
  );
  console.log(
    JSON.stringify({
      result: "verified",
      checkpointDigest: signedCheckpointDigest(checkpoint),
      anchored: result.anchored,
      missing: result.missing.length,
      modified: result.modified.length,
      newUnanchored: result.unanchored.length,
      missingSample: result.missing.slice(0, 5),
      modifiedSample: result.modified.slice(0, 5),
    }),
  );
  if (result.missing.length || result.modified.length) {
    throw new Error("PLATFORM_AUDIT_TAMPERING_DETECTED");
  }
  if (flags.has("--strict") && result.unanchored.length) {
    throw new Error("UNANCHORED_PLATFORM_AUDIT_EVENTS");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Audit attestation failed");
  process.exitCode = 1;
});
