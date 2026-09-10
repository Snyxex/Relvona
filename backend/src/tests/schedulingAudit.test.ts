import assert from "node:assert/strict";
import { resolveSchedulingAuditTarget } from "../middleware/schedulingAudit.js";

const cases: Array<[string, string, string, string | undefined]> = [
  ["DELETE", "/connections/conn-1", "scheduling.calendar.disconnect", "conn-1"],
  ["POST", "/meeting-types", "scheduling.meeting_type.create", undefined],
  ["PATCH", "/meeting-types/type-1", "scheduling.meeting_type.update", "type-1"],
  ["POST", "/availability", "scheduling.availability.create", undefined],
  ["PATCH", "/availability/rule-1", "scheduling.availability.update", "rule-1"],
  ["DELETE", "/availability/rule-2", "scheduling.availability.delete", "rule-2"],
  ["POST", "/bookings/book-1/calendar-sync/retry", "scheduling.calendar_sync.retry", "book-1"],
  ["POST", "/bookings", "scheduling.booking.create", undefined],
  ["POST", "/bookings/book-2/reschedule", "scheduling.booking.reschedule", "book-2"],
  ["POST", "/bookings/book-3/cancel", "scheduling.booking.cancel", "book-3"],
];

for (const [method, path, action, resourceId] of cases) {
  const target = resolveSchedulingAuditTarget(method, path);
  assert.ok(target, `${method} ${path} should be audited`);
  assert.equal(target.action, action);
  assert.equal(target.resourceId, resourceId);
}

assert.equal(resolveSchedulingAuditTarget("GET", "/bookings"), undefined);
assert.equal(resolveSchedulingAuditTarget("POST", "/bookings/book-4/events"), undefined);
console.log("scheduling audit target tests passed");
