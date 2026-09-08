import crypto from "crypto";
import type { CalendarBusyInterval, CalendarEventInput, CalendarEventResult, CalendarProvider } from "./calendarProvider.js";

export type GoogleCalendarCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  calendarId?: string;
};

type TokenUpdate = (credentials: GoogleCalendarCredentials) => Promise<void>;

export class GoogleCalendarProvider implements CalendarProvider {
  constructor(private credentials: GoogleCalendarCredentials, private readonly onTokenUpdate?: TokenUpdate) {}

  private async accessToken() {
    if (this.credentials.accessToken && (!this.credentials.expiresAt || this.credentials.expiresAt > Date.now() + 60_000)) return this.credentials.accessToken;
    if (!this.credentials.refreshToken) throw new Error("Google Calendar connection requires reauthorization");
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google Calendar OAuth client is not configured");

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: this.credentials.refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Unable to refresh Google Calendar access token");
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Google Calendar token response was invalid");
    this.credentials = { ...this.credentials, accessToken: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in || 3600) * 1000 };
    await this.onTokenUpdate?.(this.credentials);
    return this.credentials.accessToken;
  }

  private calendarId() { return this.credentials.calendarId || "primary"; }

  private async request(path: string, init?: RequestInit) {
    const token = await this.accessToken();
    const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Google Calendar request failed (${response.status}): ${text.slice(0, 300)}`);
    }
    if (response.status === 204) return undefined;
    return response.json();
  }

  async listBusyIntervals(data: { from: Date; to: Date }): Promise<CalendarBusyInterval[]> {
    const calendarId = this.calendarId();
    const result = await this.request("/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: data.from.toISOString(), timeMax: data.to.toISOString(), timeZone: "UTC", items: [{ id: calendarId }] }),
    }) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
    return (result?.calendars?.[calendarId]?.busy || [])
      .map((item) => ({ start: new Date(item.start), end: new Date(item.end) }))
      .filter((item) => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()));
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
    const calendarId = encodeURIComponent(this.calendarId());
    const requestId = crypto.randomUUID();
    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
      attendees: input.attendeeEmail ? [{ email: input.attendeeEmail, displayName: input.attendeeName }] : undefined,
      conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    };
    const result = await this.request(`/calendars/${calendarId}/events?conferenceDataVersion=1&sendUpdates=all`, { method: "POST", body: JSON.stringify(body) }) as any;
    return { externalEventId: result.id, meetingUrl: result.hangoutLink || result.conferenceData?.entryPoints?.find((entry: any) => entry.entryPointType === "video")?.uri };
  }

  async updateEvent(externalEventId: string, input: CalendarEventInput): Promise<CalendarEventResult> {
    const calendarId = encodeURIComponent(this.calendarId());
    const result = await this.request(`/calendars/${calendarId}/events/${encodeURIComponent(externalEventId)}?conferenceDataVersion=1&sendUpdates=all`, {
      method: "PATCH",
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
        end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail, displayName: input.attendeeName }] : undefined,
      }),
    }) as any;
    return { externalEventId: result.id, meetingUrl: result.hangoutLink || result.conferenceData?.entryPoints?.find((entry: any) => entry.entryPointType === "video")?.uri };
  }

  async deleteEvent(externalEventId: string): Promise<void> {
    const calendarId = encodeURIComponent(this.calendarId());
    await this.request(`/calendars/${calendarId}/events/${encodeURIComponent(externalEventId)}?sendUpdates=all`, { method: "DELETE" });
  }
}
