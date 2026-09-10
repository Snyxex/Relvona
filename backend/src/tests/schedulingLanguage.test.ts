import assert from "node:assert/strict";
import { detectSchedulingLanguage, formatSchedulingSlot, schedulingText } from "../services/schedulingLanguage.js";

assert.equal(detectSchedulingLanguage("Kann ich morgen einen Termin buchen?"), "de");
assert.equal(detectSchedulingLanguage("Can I book an appointment tomorrow?"), "en");
assert.equal(detectSchedulingLanguage("2"), "de", "ambiguous short input must keep the safe default");

const date = new Date("2026-09-15T10:00:00.000Z");
const deSlot = formatSchedulingSlot(date, "Europe/Berlin", "de");
const enSlot = formatSchedulingSlot(date, "Europe/Berlin", "en");
assert.ok(deSlot.length > 0);
assert.ok(enSlot.length > 0);
assert.match(schedulingText("de").selected(deSlot), /Freigabe/);
assert.match(schedulingText("en").selected(enSlot), /approval/i);
assert.match(schedulingText("de").confirmed(deSlot, "https://meet.example.test/abc"), /Meeting-Link/);
assert.match(schedulingText("en").confirmed(enSlot, "https://meet.example.test/abc"), /Meeting link/);

console.log("Scheduling language tests passed");
