import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

export type PlatformAuditEvidenceRow = {
  id: string;
  actor_identity: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at_text: string;
};

export type PlatformAuditCheckpointBody = {
  format: "relvona-platform-audit-checkpoint-v1";
  createdAt: string;
  keyId: string;
  previousCheckpointDigest: string | null;
  entryCount: number;
  entries: Array<{ id: string; sha256: string }>;
};

export type SignedPlatformAuditCheckpoint = {
  body: PlatformAuditCheckpointBody;
  signature: string;
};

export type PlatformAuditComparison = {
  anchored: number;
  missing: string[];
  modified: string[];
  unanchored: string[];
};

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    );
    return (
      "{" +
      entries
        .map(([key, entry]) => JSON.stringify(key) + ":" + canonicalJson(entry))
        .join(",") +
      "}"
    );
  }
  throw new Error("Unsupported value in platform audit evidence");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function platformAuditEvidenceHash(row: PlatformAuditEvidenceRow): string {
  // Include every persisted field, not only a summary or mutable timestamp.
  return digest({
    format: "relvona-platform-audit-entry-v1",
    id: row.id,
    actorIdentity: row.actor_identity,
    actorUserId: row.actor_user_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadata: row.metadata,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at_text,
  });
}

export function platformAuditSnapshotEntries(rows: PlatformAuditEvidenceRow[]) {
  const entries = rows.map((row) => ({
    id: row.id,
    sha256: platformAuditEvidenceHash(row),
  }));
  entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (let i = 1; i < entries.length; i++) {
    if (entries[i - 1].id === entries[i].id) {
      throw new Error("Duplicate platform audit entry ID in evidence snapshot");
    }
  }
  return entries;
}

function publicKeyFingerprint(publicPem: string): string {
  const key = createPublicKey(publicPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Platform audit attestation requires an Ed25519 public key");
  }
  const der = key.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

export function signedCheckpointDigest(checkpoint: SignedPlatformAuditCheckpoint) {
  return digest(checkpoint);
}

export function assertSignedPlatformAuditCheckpoint(
  checkpoint: SignedPlatformAuditCheckpoint,
  trustedPublicKeyPem: string,
): void {
  if (!checkpoint || typeof checkpoint !== "object") {
    throw new Error("Invalid platform audit checkpoint structure");
  }
  const { body, signature } = checkpoint;
  if (
    !body ||
    body.format !== "relvona-platform-audit-checkpoint-v1" ||
    typeof body.createdAt !== "string" ||
    Number.isNaN(Date.parse(body.createdAt)) ||
    typeof body.keyId !== "string" ||
    (body.previousCheckpointDigest !== null &&
      !/^[a-f0-9]{64}$/.test(body.previousCheckpointDigest)) ||
    !Array.isArray(body.entries) ||
    !Number.isSafeInteger(body.entryCount) ||
    body.entryCount !== body.entries.length ||
    body.entries.some(
      (entry) =>
        !entry ||
        typeof entry.id !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.sha256),
    ) ||
    typeof signature !== "string"
  ) {
    throw new Error("Malformed platform audit checkpoint");
  }
  for (let i = 1; i < body.entries.length; i++) {
    if (body.entries[i - 1].id >= body.entries[i].id) {
      throw new Error("Non-canonical or duplicate platform audit entry IDs");
    }
  }
  if (body.keyId !== publicKeyFingerprint(trustedPublicKeyPem)) {
    throw new Error("Checkpoint signing key is not independently trusted");
  }
  const valid = verify(
    null,
    Buffer.from(canonicalJson(body), "utf8"),
    createPublicKey(trustedPublicKeyPem),
    Buffer.from(signature, "base64"),
  );
  if (!valid) throw new Error("Invalid platform audit checkpoint signature");
}

export function comparePlatformAuditCheckpoint(
  checkpoint: SignedPlatformAuditCheckpoint,
  trustedPublicKeyPem: string,
  rows: PlatformAuditEvidenceRow[],
): PlatformAuditComparison {
  assertSignedPlatformAuditCheckpoint(checkpoint, trustedPublicKeyPem);
  const live = new Map(
    platformAuditSnapshotEntries(rows).map((entry) => [entry.id, entry.sha256]),
  );
  const missing: string[] = [];
  const modified: string[] = [];
  for (const entry of checkpoint.body.entries) {
    const hash = live.get(entry.id);
    if (hash === undefined) missing.push(entry.id);
    else if (hash !== entry.sha256) modified.push(entry.id);
    live.delete(entry.id);
  }
  return {
    anchored: checkpoint.body.entryCount,
    missing,
    modified,
    unanchored: [...live.keys()],
  };
}

export function createSignedPlatformAuditCheckpoint(
  rows: PlatformAuditEvidenceRow[],
  signingPrivateKeyPem: string,
  previous?: SignedPlatformAuditCheckpoint,
  trustedPublicKeyPem?: string,
): SignedPlatformAuditCheckpoint {
  const privateKey = createPrivateKey(signingPrivateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Platform audit attestation requires an Ed25519 private key");
  }
  const currentPublicKeyPem = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
  const trusted = trustedPublicKeyPem ?? currentPublicKeyPem;
  if (publicKeyFingerprint(trusted) !== publicKeyFingerprint(currentPublicKeyPem)) {
    throw new Error("Signing private key does not match trusted public key");
  }
  if (previous) {
    const comparison = comparePlatformAuditCheckpoint(previous, trusted, rows);
    if (comparison.missing.length || comparison.modified.length) {
      throw new Error("Previously anchored platform audit events were modified or removed");
    }
  }
  const entries = platformAuditSnapshotEntries(rows);
  const body: PlatformAuditCheckpointBody = {
    format: "relvona-platform-audit-checkpoint-v1",
    createdAt: new Date().toISOString(),
    keyId: publicKeyFingerprint(currentPublicKeyPem),
    previousCheckpointDigest: previous ? signedCheckpointDigest(previous) : null,
    entryCount: entries.length,
    entries,
  };
  const signature = sign(
    null,
    Buffer.from(canonicalJson(body), "utf8"),
    privateKey,
  ).toString("base64");
  return { body, signature };
}
