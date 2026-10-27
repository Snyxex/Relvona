import assert from "node:assert/strict";
import { isAvailableForAutomaticRouting } from "../services/routingAvailability.js";

const now = new Date("2026-10-27T15:00:00.000Z");
const recent = new Date(now.getTime() - 60_000);
const stale = new Date(now.getTime() - 6 * 60_000);
assert.equal(isAvailableForAutomaticRouting("AVAILABLE", recent, now), true);
assert.equal(isAvailableForAutomaticRouting("ONLINE", recent, now), true);
for (const status of ["BUSY", "OFFLINE", "AWAY", "DND", undefined, null]) {
  assert.equal(isAvailableForAutomaticRouting(status, recent, now), false, `${status} must be excluded`);
}
assert.equal(isAvailableForAutomaticRouting("AVAILABLE", stale, now), false, "stale presence must be excluded");
assert.equal(isAvailableForAutomaticRouting("ONLINE", null, now), false, "missing presence must be excluded");
assert.equal(isAvailableForAutomaticRouting("ONLINE", new Date(now.getTime() + 60_000), now), false, "future presence must be excluded");
console.log("Ticket routing availability checks passed");
