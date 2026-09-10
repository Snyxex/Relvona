import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { meetingTypes } from "../db/extendedCustomerExperienceSchema.js";

function normalizeSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export class MeetingTypeAdminService {
  static async update(organizationId: string, meetingTypeId: string, input: Record<string, unknown>) {
    const [existing] = await db.select().from(meetingTypes).where(and(eq(meetingTypes.organizationId, organizationId), eq(meetingTypes.id, meetingTypeId))).limit(1);
    if (!existing) throw new Error("Meeting type not found");

    const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : existing.name;
    const slug = typeof input.slug === "string" ? normalizeSlug(input.slug) : existing.slug;
    const durationMinutes = typeof input.durationMinutes === "number" ? input.durationMinutes : existing.durationMinutes;
    const bufferBeforeMinutes = typeof input.bufferBeforeMinutes === "number" ? input.bufferBeforeMinutes : existing.bufferBeforeMinutes;
    const bufferAfterMinutes = typeof input.bufferAfterMinutes === "number" ? input.bufferAfterMinutes : existing.bufferAfterMinutes;
    const minimumNoticeMinutes = typeof input.minimumNoticeMinutes === "number" ? input.minimumNoticeMinutes : existing.minimumNoticeMinutes;
    const maxFutureDays = typeof input.maxFutureDays === "number" ? input.maxFutureDays : existing.maxFutureDays;
    const enabled = typeof input.enabled === "boolean" ? input.enabled : existing.enabled;
    const description = typeof input.description === "string" ? input.description.trim().slice(0, 2_000) : existing.description;

    if (!name || !slug || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) throw new Error("Invalid meeting type");
    if (!Number.isInteger(bufferBeforeMinutes) || bufferBeforeMinutes < 0 || bufferBeforeMinutes > 240) throw new Error("Invalid meeting type");
    if (!Number.isInteger(bufferAfterMinutes) || bufferAfterMinutes < 0 || bufferAfterMinutes > 240) throw new Error("Invalid meeting type");
    if (!Number.isInteger(minimumNoticeMinutes) || minimumNoticeMinutes < 0 || minimumNoticeMinutes > 10080) throw new Error("Invalid meeting type");
    if (!Number.isInteger(maxFutureDays) || maxFutureDays < 1 || maxFutureDays > 365) throw new Error("Invalid meeting type");

    const [updated] = await db.update(meetingTypes).set({
      name,
      slug,
      description,
      durationMinutes,
      bufferBeforeMinutes,
      bufferAfterMinutes,
      minimumNoticeMinutes,
      maxFutureDays,
      enabled,
      updatedAt: new Date(),
    }).where(and(eq(meetingTypes.organizationId, organizationId), eq(meetingTypes.id, meetingTypeId))).returning();

    return updated;
  }
}
