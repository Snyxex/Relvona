import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { calendarConnections } from "../db/extendedCustomerExperienceSchema.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";
import type { CalendarProvider } from "./calendarProvider.js";
import { GoogleCalendarProvider, type GoogleCalendarCredentials } from "./googleCalendarProvider.js";

function parseCredentials<T>(encrypted: string | null): T {
  const plaintext = decryptSecret(encrypted);
  if (!plaintext) throw new Error("Calendar connection credentials are unavailable");
  try { return JSON.parse(plaintext) as T; } catch { throw new Error("Calendar connection credentials are invalid"); }
}

export class CalendarProviderFactory {
  static async forUser(organizationId: string, userId: string): Promise<CalendarProvider | undefined> {
    const [connection] = await db.select().from(calendarConnections).where(and(
      eq(calendarConnections.organizationId, organizationId),
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.status, "active"),
    )).limit(1);
    if (!connection) return undefined;

    if (connection.provider === "google") {
      const credentials = parseCredentials<GoogleCalendarCredentials>(connection.encryptedCredentials);
      return new GoogleCalendarProvider(credentials, async (updated) => {
        await db.update(calendarConnections).set({ encryptedCredentials: encryptSecret(JSON.stringify(updated)), updatedAt: new Date() })
          .where(and(eq(calendarConnections.organizationId, organizationId), eq(calendarConnections.id, connection.id)));
      });
    }

    throw new Error(`Unsupported calendar provider: ${connection.provider}`);
  }
}
