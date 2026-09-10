import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { S3CompatibleObjectStorageProvider } from "../services/objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";

async function main() {
  const config = objectStorageConfig();
  if (config.provider !== "rustfs" || !config.endpoint || !config.bucket) {
    console.log("RustFS integration test skipped: configure OBJECT_STORAGE_PROVIDER=rustfs and endpoint/bucket variables.");
    return;
  }

  const storage = new S3CompatibleObjectStorageProvider();
  const key = `integration-tests/${randomUUID()}/object`;
  const body = Buffer.from("rustfs integration test", "utf8");

  await storage.ensureReady();
  try {
    await storage.putObject(key, {
      body,
      contentLength: body.length,
      contentType: "text/plain",
      sha256: "integration-test",
    });

    assert.equal(await storage.objectExists(key), true);
    const metadata = await storage.getObjectMetadata(key);
    assert.equal(metadata.contentLength, body.length);
    assert.equal(metadata.contentType, "text/plain");

    const result = await storage.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    assert.equal(Buffer.concat(chunks).toString("utf8"), body.toString("utf8"));

    const signed = await storage.createSignedDownloadUrl(key, 60);
    assert.doesNotThrow(() => new URL(signed));
  } finally {
    await storage.deleteObject(key).catch(() => undefined);
  }

  assert.equal(await storage.objectExists(key), false);
  console.log("RustFS integration smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
