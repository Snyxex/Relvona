import assert from "node:assert/strict";
import test from "node:test";

import {
  aiResolutionPercent,
  distributionPercent,
} from "../src/lib/support-metrics.ts";
import {
  TICKET_STATUS_OPTIONS,
  ticketStatusLabel,
  ticketStatusTone,
} from "../src/lib/support-status.ts";

test("ticket status options have unique stable values and labels", () => {
  const values = TICKET_STATUS_OPTIONS.map((status) => status.value);
  assert.equal(new Set(values).size, values.length);
  for (const option of TICKET_STATUS_OPTIONS) {
    assert.equal(ticketStatusLabel(option.value), option.label);
    assert.equal(ticketStatusTone(option.value), option.value);
  }
});

test("unknown status labels are preserved but cannot construct arbitrary CSS tones", () => {
  assert.equal(ticketStatusLabel("custom_state"), "custom_state");
  assert.equal(ticketStatusTone("custom_state"), "unknown");
  assert.equal(ticketStatusTone("open custom-style"), "unknown");
});

test("AI resolution percentages use the actual AI event count, not all resolved tickets", () => {
  assert.equal(aiResolutionPercent(2, 10), 20);
  assert.equal(aiResolutionPercent(0, 10), 0);
  assert.equal(aiResolutionPercent(20, 10), 100);
  assert.equal(aiResolutionPercent(2, 0), null);
  assert.equal(aiResolutionPercent(undefined, 10), null);
  assert.equal(aiResolutionPercent(-1, 10), null);
  assert.equal(aiResolutionPercent(Number.NaN, 10), null);
});

test("chart percentages are bounded and tolerate empty or invalid data", () => {
  assert.equal(distributionPercent(3, 12), 25);
  assert.equal(distributionPercent(0, 12), 0);
  assert.equal(distributionPercent(1, 0), 0);
  assert.equal(distributionPercent(100, 10), 100);
  assert.equal(distributionPercent(-2, 10), 0);
  assert.equal(distributionPercent(Number.POSITIVE_INFINITY, 10), 0);
});
