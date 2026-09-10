import assert from "node:assert/strict";
import {
  currentDatabaseTenant,
  setDatabaseTenant,
  withDatabaseTenantContext,
} from "../db/tenantContext.js";

assert.equal(currentDatabaseTenant(), undefined, "tenant context must be empty outside a scoped request");
assert.throws(() => setDatabaseTenant("00000000-0000-4000-8000-000000000001"), /not initialized/i);

await withDatabaseTenantContext(async () => {
  assert.equal(currentDatabaseTenant(), undefined);
  setDatabaseTenant("00000000-0000-4000-8000-000000000001");
  assert.equal(currentDatabaseTenant(), "00000000-0000-4000-8000-000000000001");
  await Promise.resolve();
  assert.equal(currentDatabaseTenant(), "00000000-0000-4000-8000-000000000001", "tenant must survive async boundaries");

  await withDatabaseTenantContext(async () => {
    assert.equal(currentDatabaseTenant(), undefined, "nested context must start isolated");
    setDatabaseTenant("00000000-0000-4000-8000-000000000002");
    assert.equal(currentDatabaseTenant(), "00000000-0000-4000-8000-000000000002");
  });

  assert.equal(currentDatabaseTenant(), "00000000-0000-4000-8000-000000000001", "nested context must not overwrite its parent");
});

assert.equal(currentDatabaseTenant(), undefined, "tenant context must not leak after request completion");
console.log("Database tenant context isolation passed.");
