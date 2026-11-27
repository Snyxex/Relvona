import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import {
  assertSignedPlatformAuditCheckpoint,
  comparePlatformAuditCheckpoint,
  createSignedPlatformAuditCheckpoint,
  platformAuditEvidenceHash,
  signedCheckpointDigest,
  type PlatformAuditEvidenceRow,
} from "../services/platformAuditAttestation.js";

const keyPair = generateKeyPairSync("ed25519");
const trustedPublic = keyPair.publicKey.export({
  type: "spki",
  format: "pem",
}).toString();
const signingPrivate = keyPair.privateKey.export({
  type: "pkcs8",
  format: "pem",
}).toString();

const row: PlatformAuditEvidenceRow = {
  id: "00000000-0000-4000-8000-000000000001",
  actor_identity: "platform-user:00000000-0000-4000-8000-000000000002",
  actor_user_id: "00000000-0000-4000-8000-000000000002",
  action: "platform.security.two_factor_policy.changed",
  resource_type: "platform_security_settings",
  resource_id: "global",
  metadata: { previousPolicy: "recommended", newPolicy: "required" },
  ip_address: "127.0.0.1",
  user_agent: "Relvona platform audit integration",
  created_at_text: "2026-11-27 09:00:00.123456",
};

test("audit evidence includes all persisted attributes and canonical metadata", () => {
  const reordered = {
    ...row,
    metadata: { newPolicy: "required", previousPolicy: "recommended" },
  };
  assert.equal(platformAuditEvidenceHash(row), platformAuditEvidenceHash(reordered));
  assert.notEqual(
    platformAuditEvidenceHash(row),
    platformAuditEvidenceHash({ ...row, resource_id: "tampered" }),
  );
  assert.notEqual(
    platformAuditEvidenceHash(row),
    platformAuditEvidenceHash({ ...row, created_at_text: "2026-11-27 09:00:00.123457" }),
  );
  assert.notEqual(
    platformAuditEvidenceHash(row),
    platformAuditEvidenceHash({ ...row, metadata: { previousPolicy: "disabled" } }),
  );
});

test("Ed25519 checkpoint is independently verifiable", () => {
  const checkpoint = createSignedPlatformAuditCheckpoint(
    [row],
    signingPrivate,
    undefined,
    trustedPublic,
  );
  assert.equal(checkpoint.body.entryCount, 1);
  assert.equal(checkpoint.body.previousCheckpointDigest, null);
  assertSignedPlatformAuditCheckpoint(checkpoint, trustedPublic);
  assert.deepEqual(
    comparePlatformAuditCheckpoint(checkpoint, trustedPublic, [row]),
    { anchored: 1, missing: [], modified: [], unanchored: [] },
  );

  const attackerKey = generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "pem" }).toString();
  assert.throws(
    () => assertSignedPlatformAuditCheckpoint(checkpoint, attackerKey),
    /not independently trusted/,
  );
  const falsified = {
    ...checkpoint,
    body: { ...checkpoint.body, createdAt: "2020-01-01T00:00:00.000Z" },
  };
  assert.throws(
    () => assertSignedPlatformAuditCheckpoint(falsified, trustedPublic),
    /Invalid platform audit checkpoint signature/,
  );
});

test("deleted or modified global events cannot match an earlier signed checkpoint", () => {
  const checkpoint = createSignedPlatformAuditCheckpoint([row], signingPrivate);
  assert.deepEqual(
    comparePlatformAuditCheckpoint(checkpoint, trustedPublic, []).missing,
    [row.id],
  );
  assert.deepEqual(
    comparePlatformAuditCheckpoint(
      checkpoint,
      trustedPublic,
      [{ ...row, actor_identity: "unix:attacker@db" }],
    ).modified,
    [row.id],
  );
  assert.throws(
    () =>
      createSignedPlatformAuditCheckpoint(
        [{ ...row, action: "platform.role.granted" }],
        signingPrivate,
        checkpoint,
        trustedPublic,
      ),
    /modified or removed/,
  );
});

test("consecutive checkpoints link without rejecting newer legitimate events", () => {
  const first = createSignedPlatformAuditCheckpoint([row], signingPrivate);
  const newer = {
    ...row,
    id: "00000000-0000-4000-8000-000000000003",
    action: "platform.role.granted",
    created_at_text: "2026-11-27 09:01:00",
  };
  const second = createSignedPlatformAuditCheckpoint(
    [row, newer],
    signingPrivate,
    first,
    trustedPublic,
  );
  assert.equal(second.body.entryCount, 2);
  assert.equal(second.body.previousCheckpointDigest, signedCheckpointDigest(first));
  assert.deepEqual(
    comparePlatformAuditCheckpoint(first, trustedPublic, [row, newer]).unanchored,
    [newer.id],
  );
  assert.deepEqual(
    comparePlatformAuditCheckpoint(second, trustedPublic, [row, newer]),
    { anchored: 2, missing: [], modified: [], unanchored: [] },
  );
});

test("duplicate audit event IDs and noncanonical snapshots are rejected", () => {
  assert.throws(
    () => createSignedPlatformAuditCheckpoint([row, row], signingPrivate),
    /Duplicate platform audit entry ID/,
  );
  const valid = createSignedPlatformAuditCheckpoint([row], signingPrivate);
  assert.throws(
    () =>
      assertSignedPlatformAuditCheckpoint(
        { ...valid, body: { ...valid.body, entryCount: 0 } },
        trustedPublic,
      ),
    /Malformed platform audit checkpoint/,
  );
});
