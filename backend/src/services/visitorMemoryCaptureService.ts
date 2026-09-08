import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { anonymousVisitors, visitorConversations, visitorMemories } from "../db/extendedCustomerExperienceSchema.js";
import { PiiRedactionService } from "./piiRedactionService.js";
import { VisitorIdentityService } from "./visitorIdentityService.js";

const TECHNICAL_SIGNAL = /\b(api|docker|container|server|deployment|deploy|database|mysql|postgres|redis|windows|linux|browser|login|auth|token|key|timeout|network|dns|ssl|tls|error|fehler|bug|version|connection|verbindung|webhook|integration)\b/i;
const TRANSIENT_SIGNAL = /\b(today|tomorrow|heute|morgen|currently|gerade|jetzt|temporary|temporär)\b/i;

function compact(text: string, max = 420): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function fingerprint(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 240);
}

/**
 * Privacy-first automatic memory capture.
 *
 * This deliberately does not ask the model to invent a customer profile. Only
 * already-redacted support text is considered, and only when it contains a
 * concrete technical/support signal. Direct identifiers are redacted again
 * before persistence as defense in depth.
 */
export class VisitorMemoryCaptureService {
  static async captureExchange(data: {
    organizationId: string;
    conversationId: string;
    customerText: string;
    assistantText: string;
    handoffTriggered: boolean;
  }) {
    const [link] = await db.select({ visitorId: visitorConversations.visitorId })
      .from(visitorConversations)
      .where(and(
        eq(visitorConversations.organizationId, data.organizationId),
        eq(visitorConversations.conversationId, data.conversationId),
      ))
      .limit(1);
    if (!link) return undefined;

    const [visitor] = await db.select({ memoryEnabled: anonymousVisitors.memoryEnabled })
      .from(anonymousVisitors)
      .where(and(
        eq(anonymousVisitors.organizationId, data.organizationId),
        eq(anonymousVisitors.id, link.visitorId),
      ))
      .limit(1);
    if (!visitor?.memoryEnabled) return undefined;

    const customer = PiiRedactionService.redact(compact(data.customerText)).text;
    const assistant = PiiRedactionService.redact(compact(data.assistantText)).text;
    if (!customer || !TECHNICAL_SIGNAL.test(customer)) return undefined;

    const type = data.handoffTriggered ? "support_issue" : "resolution";
    const summary = data.handoffTriggered
      ? `Open/recent support issue: ${customer}`
      : `Previous issue: ${customer} | Support response: ${assistant}`;
    const normalized = fingerprint(summary);
    if (!normalized) return undefined;

    // Keep automatic memory low-noise. Avoid recording the same exchange again
    // when retries/replays occur or a similar recent memory already exists.
    const recent = await db.select({ summary: visitorMemories.summary })
      .from(visitorMemories)
      .where(and(
        eq(visitorMemories.organizationId, data.organizationId),
        eq(visitorMemories.visitorId, link.visitorId),
      ))
      .orderBy(desc(visitorMemories.createdAt))
      .limit(20);
    if (recent.some((memory) => fingerprint(memory.summary) === normalized)) return undefined;

    const expiresAt = TRANSIENT_SIGNAL.test(customer)
      ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    return VisitorIdentityService.createMemory({
      organizationId: data.organizationId,
      visitorId: link.visitorId,
      type,
      summary: summary.slice(0, 900),
      sourceConversationId: data.conversationId,
      expiresAt,
      metadata: { source: "automatic_support_exchange", version: 1 },
    });
  }
}
