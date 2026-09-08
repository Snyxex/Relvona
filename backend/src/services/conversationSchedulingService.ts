import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { conversationSchedulingStates } from "../db/conversationSchedulingSchema.js";
import { meetingTypes } from "../db/extendedCustomerExperienceSchema.js";
import { ActionExecutionService } from "./actionExecutionService.js";
import { SchedulingService } from "./schedulingService.js";

const meetingIntent = /\b(termin|meeting|besprechung|gespräch|telefonieren|anruf|call|appointment|schedule|meet|demo)\b/i;
const cancelIntent = /\b(abbrechen|vergiss|doch nicht|cancel|nevermind)\b/i;

function dateWindow(text: string) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (/\b(morgen|tomorrow)\b/i.test(text)) {
    start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime()); end.setDate(end.getDate() + 1);
    return { from: start, to: end };
  }
  if (/\b(übermorgen|day after tomorrow)\b/i.test(text)) {
    start.setDate(start.getDate() + 2); start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime()); end.setDate(end.getDate() + 1);
    return { from: start, to: end };
  }
  start.setMinutes(start.getMinutes() + 60);
  end.setDate(end.getDate() + 7);
  return { from: start, to: end };
}

function formatSlot(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function selectedIndex(text: string, slots: Array<{ startsAt: string; timezone: string }>) {
  const normalized = text.trim().toLowerCase();
  const ordinal: Record<string, number> = { "1": 0, "erste": 0, "first": 0, "2": 1, "zweite": 1, "second": 1, "3": 2, "dritte": 2, "third": 2 };
  for (const [token, index] of Object.entries(ordinal)) if (new RegExp(`\\b${token}\\b`, "i").test(normalized) && slots[index]) return index;
  const match = normalized.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!match) return -1;
  const hours = Number(match[1]); const minutes = Number(match[2]);
  return slots.findIndex((slot) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: slot.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(slot.startsAt));
    const h = Number(parts.find((part) => part.type === "hour")?.value); const m = Number(parts.find((part) => part.type === "minute")?.value);
    return h === hours && m === minutes;
  });
}

export class ConversationSchedulingService {
  static async handle(data: { organizationId: string; conversationId: string; customerId?: string; text: string }) {
    let [state] = await db.select().from(conversationSchedulingStates).where(and(eq(conversationSchedulingStates.organizationId, data.organizationId), eq(conversationSchedulingStates.conversationId, data.conversationId))).limit(1);

    if (cancelIntent.test(data.text) && state && state.state !== "booked") {
      await db.update(conversationSchedulingStates).set({ state: "cancelled", offeredSlots: [], updatedAt: new Date() }).where(eq(conversationSchedulingStates.id, state.id));
      return { handled: true, reply: "Die Terminplanung wurde abgebrochen." };
    }

    if (state?.state === "offered") {
      const slots = Array.isArray(state.offeredSlots) ? state.offeredSlots as Array<{ startsAt: string; timezone: string }> : [];
      const index = selectedIndex(data.text, slots);
      if (index >= 0) {
        const selected = slots[index];
        const idempotencyKey = `conversation-booking:${data.conversationId}:${selected.startsAt}`;
        const execution = await ActionExecutionService.request({
          context: { organizationId: data.organizationId, conversationId: data.conversationId, customerId: data.customerId, actorRole: "agent" },
          toolId: "scheduling.create_booking",
          input: {
            meetingTypeId: state.meetingTypeId!,
            assignedUserId: state.assignedUserId || undefined,
            startsAt: selected.startsAt,
            timezone: selected.timezone,
            idempotencyKey,
          },
          requestedByType: "ai",
          idempotencyKey,
        });
        await db.update(conversationSchedulingStates).set({ state: "approval_pending", selectedStartsAt: new Date(selected.startsAt), selectedTimezone: selected.timezone, actionExecutionId: execution.id, updatedAt: new Date() }).where(eq(conversationSchedulingStates.id, state.id));
        return { handled: true, reply: `Ich habe ${formatSlot(new Date(selected.startsAt), selected.timezone)} ausgewählt. Der Termin wartet jetzt auf die erforderliche Freigabe.`, actionExecutionId: execution.id };
      }
    }

    if (!meetingIntent.test(data.text)) return { handled: false };

    const types = await SchedulingService.listMeetingTypes(data.organizationId);
    const enabled = types.filter((type) => type.enabled);
    if (!enabled.length) return { handled: true, reply: "Für diese Organisation sind aktuell keine buchbaren Terminarten eingerichtet." };

    const preferred = enabled.find((type) => new RegExp(type.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(data.text)) || enabled[0];
    const { from, to } = dateWindow(data.text);
    const slots = await SchedulingService.findAvailableSlots({ organizationId: data.organizationId, meetingTypeId: preferred.id, from, to, limit: 3 });
    if (!slots.length) return { handled: true, reply: "Ich konnte im gewünschten Zeitraum keinen freien Termin finden. Sie können mir einen anderen Zeitraum nennen." };

    const serialized = slots.map((slot) => ({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), timezone: slot.timezone }));
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    if (state) {
      [state] = await db.update(conversationSchedulingStates).set({ meetingTypeId: preferred.id, state: "offered", offeredSlots: serialized, expiresAt, updatedAt: new Date() }).where(eq(conversationSchedulingStates.id, state.id)).returning();
    } else {
      [state] = await db.insert(conversationSchedulingStates).values({ organizationId: data.organizationId, conversationId: data.conversationId, meetingTypeId: preferred.id, state: "offered", offeredSlots: serialized, expiresAt }).returning();
    }
    const options = serialized.map((slot, index) => `${index + 1}. ${formatSlot(new Date(slot.startsAt), slot.timezone)}`).join("\n");
    return { handled: true, reply: `Für „${preferred.name}“ sind diese Zeiten frei:\n${options}\n\nWelche Zeit passt Ihnen?` };
  }
}
