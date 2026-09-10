import assert from "node:assert/strict";
import {
  currentDatabaseContext,
  currentDatabaseTenant,
  setDatabaseTenant,
  withDatabaseTenantContext,
} from "../db/tenantContext.js";

assert.equal(currentDatabaseTenant(), undefined, "tenant context must be empty outside a scoped request");
assert.equal(currentDatabaseContext(), undefined, "database context must be empty outside a scoped request");
assert.throws(() => setDatabaseTenant("00000000-0000-4000-8000-000000000001"), /not initialized/i);

await withDatabaseTenantContext(async () => {
  assert.equal(currentDatabaseTenant(), undefined);
  assert.equal(currentDatabaseContext()?.requestScoped, false, "transient tenant contexts must not lease request-pool clients");
  setDatabaseTenant("00000000-0000-4000-8000-000000000001");
  assert.equal(currentDatabaseTenant(), "00000000-0000-4000-8000-000000000001");
  await Promise.resolve();
  assert.equal(currentDatabaseTenant(), "00000000-0000-4000-8000-000000000001", "tenant must survive async boundaries");

  await withDatabaseTenantContext(async () => {
    assert.equal(currentDatabaseTenant(), undefined, "nested context must start isolated");
    assert.equal(currentDatabaseContext()?.requestScoped, false);
    setDatabaseTenant("00000000-0000-4000-8000-000000000002");
    assert.equal(currentDatabaseTenant(), "00000000-0000-4000-8000-000000000002");
  });

  assert.equal(currentDatabaseTenant(), "00000000-0000-4000-8000-000000000001", "nested context must not overwrite its parent");
});

assert.equal(currentDatabaseTenant(), undefined, "tenant context must not leak after request completion");
assert.equal(currentDatabaseContext(), undefined, "database context must not leak after scoped work");
console.log("Database tenant context isolation passed.");
