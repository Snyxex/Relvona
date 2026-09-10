import assert from "node:assert/strict";
import { StorageQuotaService } from "../services/storageQuotaService.js";

const original = process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES;

try {
  delete process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES;
  assert.equal(StorageQuotaService.quotaBytes(), 10 * 1024 * 1024 * 1024);

  process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES = "0";
  assert.equal(StorageQuotaService.quotaBytes(), 0);

  process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES = "1073741824";
  assert.equal(StorageQuotaService.quotaBytes(), 1024 * 1024 * 1024);

  process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES = "-1";
  assert.throws(() => StorageQuotaService.quotaBytes(), /non-negative safe integer/);

  process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES = "1.5";
  assert.throws(() => StorageQuotaService.quotaBytes(), /non-negative safe integer/);

  console.log("Storage quota configuration tests passed.");
} finally {
  if (original === undefined) delete process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES;
  else process.env.OBJECT_STORAGE_TENANT_QUOTA_BYTES = original;
}
