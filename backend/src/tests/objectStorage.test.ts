import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FilesystemObjectStorage } from "../services/objectStorage.js";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "supportai-storage-"));
  try {
    const storage = new FilesystemObjectStorage(root);
    const key = "organizations/tenant-a/knowledge/uploads/object-a/raw/original-file";
    await storage.putObject(key, { body: Buffer.from("private tenant data"), contentLength: 19, contentType: "text/plain" });
    assert.equal(await storage.objectExists(key), true);
    assert.equal((await storage.getObjectMetadata(key)).contentLength, 19);
    const object = await storage.getObject(key); const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), "private tenant data");
    await assert.rejects(storage.getObject("../tenant-b/object"), /Invalid storage key/);
    await storage.deleteObject(key); assert.equal(await storage.objectExists(key), false);
    console.log("Object storage contract tests passed.");
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
