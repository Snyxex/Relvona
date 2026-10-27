import type { WeeklyShift } from "../db/supportScheduleSchema.js";

export type Schedule = { timezone: string; weeklyShifts: WeeklyShift[] } | null | undefined;
export type Absence = { startsAt: Date; endsAt: Date };

/** Weekly shifts use local weekday (0=Sunday) and local wall clock in the configured IANA timezone. */
export function isWithinScheduledHours(schedule: Schedule, now = new Date()): boolean {
  // Without an explicit schedule, keep legacy availability behavior.
  if (!schedule) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone, weekday: "short", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const minuteOfDay = Number(get("hour")) * 60 + Number(get("minute"));
  return schedule.weeklyShifts.some(shift => {
    if (shift.day !== day) return false;
    return clockMinutes(shift.start) <= minuteOfDay && minuteOfDay < clockMinutes(shift.end);
  });
}

export function clockMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("Invalid shift time");
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function normalizeShifts(value: unknown): WeeklyShift[] {
  if (!Array.isArray(value) || value.length > 28) throw new Error("Invalid weekly shifts");
  const shifts: WeeklyShift[] = value.map(item => {
    if (!item || typeof item !== "object" || !Number.isInteger(item.day) || item.day < 0 || item.day > 6
      || typeof item.start !== "string" || typeof item.end !== "string"
      || clockMinutes(item.start) >= clockMinutes(item.end)) throw new Error("Invalid weekly shifts");
    return { day: item.day, start: item.start, end: item.end };
  });
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    const windows = shifts.filter(s => s.day === day).sort((a,b) => clockMinutes(a.start)-clockMinutes(b.start));
    if (windows.some((s,i) => i>0 && clockMinutes(s.start) < clockMinutes(windows[i-1].end))) throw new Error("Overlapping shifts");
  }
  return shifts;
}

export function isAbsent(absences: Absence[], now = new Date()): boolean {
  return absences.some(a => a.startsAt <= now && now < a.endsAt);
}

export function assertTimezone(zone: unknown): string {
  if (typeof zone !== "string" || zone.length > 80) throw new Error("Invalid timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); }
  catch { throw new Error("Invalid timezone"); }
  return zone;
}
