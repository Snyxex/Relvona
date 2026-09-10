import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { availabilityRules, meetingTypes } from "../db/extendedCustomerExperienceSchema.js";
import { organizationMembers } from "../db/schema.js";

function validTimezone(value: string) {
  try { Intl.DateTimeFormat("en", { timeZone: value }).format(new Date()); return true; } catch { return false; }
}

function validate(data: { weekday: number; startMinute: number; endMinute: number; timezone: string }) {
  if (!Number.isInteger(data.weekday) || data.weekday < 0 || data.weekday > 6) throw new Error("Invalid availability rule");
  if (!Number.isInteger(data.startMinute) || !Number.isInteger(data.endMinute) || data.startMinute < 0 || data.endMinute > 1440 || data.startMinute >= data.endMinute) throw new Error("Invalid availability rule");
  if (!validTimezone(data.timezone)) throw new Error("Invalid availability rule");
}

export class AvailabilityAdminService {
  static async update(organizationId: string, ruleId: string, input: Record<string, unknown>) {
    const [existing] = await db.select().from(availabilityRules).where(and(eq(availabilityRules.organizationId, organizationId), eq(availabilityRules.id, ruleId))).limit(1);
    if (!existing) throw new Error("Availability rule not found");

    const weekday = typeof input.weekday === "number" ? input.weekday : existing.weekday;
    const startMinute = typeof input.startMinute === "number" ? input.startMinute : existing.startMinute;
    const endMinute = typeof input.endMinute === "number" ? input.endMinute : existing.endMinute;
    const timezone = typeof input.timezone === "string" ? input.timezone.trim() : existing.timezone;
    const enabled = typeof input.enabled === "boolean" ? input.enabled : existing.enabled;
    const meetingTypeId = input.meetingTypeId === null ? undefined : typeof input.meetingTypeId === "string" ? input.meetingTypeId : existing.meetingTypeId || undefined;
    const userId = input.userId === null ? undefined : typeof input.userId === "string" ? input.userId : existing.userId || undefined;

    validate({ weekday, startMinute, endMinute, timezone });
    if (meetingTypeId) {
      const [type] = await db.select({ id: meetingTypes.id }).from(meetingTypes).where(and(eq(meetingTypes.organizationId, organizationId), eq(meetingTypes.id, meetingTypeId))).limit(1);
      if (!type) throw new Error("Meeting type not found");
    }
    if (userId) {
      const [member] = await db.select({ id: organizationMembers.id }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active"))).limit(1);
      if (!member) throw new Error("User not found");
    }

    const [updated] = await db.update(availabilityRules).set({ weekday, startMinute, endMinute, timezone, enabled, meetingTypeId: meetingTypeId || null, userId: userId || null, updatedAt: new Date() }).where(and(eq(availabilityRules.organizationId, organizationId), eq(availabilityRules.id, ruleId))).returning();
    return updated;
  }

  static async remove(organizationId: string, ruleId: string) {
    const [deleted] = await db.delete(availabilityRules).where(and(eq(availabilityRules.organizationId, organizationId), eq(availabilityRules.id, ruleId))).returning({ id: availabilityRules.id });
    if (!deleted) throw new Error("Availability rule not found");
  }
}
