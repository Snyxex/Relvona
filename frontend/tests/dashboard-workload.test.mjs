import assert from "node:assert/strict";
import test from "node:test";
import { ticketWorkload } from "../src/lib/support-metrics.ts";

test("ticket workload counts active work across all status buckets", () => {
  assert.deepEqual(
    ticketWorkload([
      { status: "open", total: 4 },
      { status: "in_progress", total: 3 },
      { status: "pending", total: 2 },
      { status: "resolved", total: 40 },
      { status: "closed", total: 12 },
      { status: "custom", total: 8 },
    ]),
    { open: 4, inProgress: 3, pending: 2, total: 9 },
  );
});

test("an empty or fully completed queue has no outstanding work", () => {
  const empty = { open: 0, inProgress: 0, pending: 0, total: 0 };
  assert.deepEqual(ticketWorkload([]), empty);
  assert.deepEqual(ticketWorkload([{ status: "resolved", total: 5 }]), empty);
});
