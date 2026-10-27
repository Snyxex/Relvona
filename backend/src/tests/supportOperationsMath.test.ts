import assert from "node:assert/strict";
import { completeDailySeries, estimateSupportDemand, safeRate } from "../services/supportOperationsMath.js";

assert.equal(safeRate(3, 4), 0.75);
assert.equal(safeRate(0, 10), 0);
assert.equal(safeRate(0, 0), null, "no eligible SLA cases must display unknown, not 100%");
assert.equal(safeRate(1, -1), null);

const noData = estimateSupportDemand({ arrivals14: 0, resolved14: 0, backlog: 0, availableAgents: 2 });
assert.equal(noData.risk, "insufficient_data");
assert.equal(noData.estimatedBacklogAfter7Days, 0);

const noCoverage = estimateSupportDemand({ arrivals14: 14, resolved14: 0, backlog: 9, availableAgents: 0 });
assert.equal(noCoverage.risk, "no_coverage");
assert.equal(noCoverage.estimatedBacklogAfter7Days, 16);

const growing = estimateSupportDemand({ arrivals14: 42, resolved14: 14, backlog: 12, availableAgents: 1 });
assert.equal(growing.estimatedBacklogAfter7Days, 26);
assert.equal(growing.risk, "high");

const shrinking = estimateSupportDemand({ arrivals14: 14, resolved14: 28, backlog: 4, availableAgents: 3 });
assert.equal(shrinking.estimatedBacklogAfter7Days, 0);
assert.equal(shrinking.risk, "low");

const completed = completeDailySeries(3, new Date("2026-10-27T18:20:00Z"),
  [{ day: "2026-10-25", total: 2 }, { day: "2026-10-27", total: 4 }],
  [{ day: "2026-10-26", total: 1 }]);
assert.deepEqual(completed, [
  { day: "2026-10-25", arrivals: 2, resolutions: 0 },
  { day: "2026-10-26", arrivals: 0, resolutions: 1 },
  { day: "2026-10-27", arrivals: 4, resolutions: 0 },
]);
console.log("Support operations analytics calculation tests passed");
