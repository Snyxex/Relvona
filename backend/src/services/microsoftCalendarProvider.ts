import type { CalendarBusyInterval, CalendarEventInput, CalendarEventResult, CalendarProvider } from "./calendarProvider.js";

export type MicrosoftCalendarCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  calendarId?: string;
};

type TokenUpdate = (credentials: MicrosoftCalendarCredentials) => Promise<void>;

export class MicrosoftCalendarProvider implements CalendarProvider {
  constructor(private credentials: MicrosoftCalendarCredentials, private readonly onTokenUpdate?: TokenUpdate) {}

  private async accessToken() {
    if (this.credentials.accessToken && (!this.credentials.expiresAt || this.credentials.expiresAt > Date.now() + 60_000)) return this.credentials.accessToken;
    if (!this.credentials.refreshToken) throw new Error("Microsoft Calendar connection requires reauthorization");
    const clientId = process.env.MICROSOFT_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
    const tenant = process.env.MICROSOFT_CALENDAR_TENANT_ID || "common";
    if (!clientId || !clientSecret) throw new Error("Microsoft Calendar OAuth client is not configured");

    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: "refresh_token",
        scope: "offline_access Calendars.ReadWrite",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Unable to refresh Microsoft Calendar access token");
    const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Microsoft Calendar token response was invalid");
    this.credentials = {
      ...this.credentials,
      accessToken: body.access_token,
      refreshToken: body.refresh_token || this.credentials.refreshToken,
      expiresAt: Date.now() + Math.max(60, body.expires_in || 3600) * 1000,
    };
    await this.onTokenUpdate?.(this.credentials);
    return this.credentials.accessToken;
  }

  private basePath() {
    return this.credentials.userId ? `/users/${encodeURIComponent(this.credentials.userId)}` : "/me";
  }

  private async request(path: string, init?: RequestInit) {
    const token = await this.accessToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Microsoft Graph request failed (${response.status}): ${text.slice(0, 300)}`);
    }
    if (response.status === 204) return undefined;
    return response.json();
  }

  async listBusyIntervals(data: { from: Date; to: Date }): Promise<CalendarBusyInterval[]> {
    const schedule = this.credentials.userId || "me";
    const result = await this.request(`${this.basePath()}/calendar/getSchedule`, {
      method: "POST",
      headers: { Prefer: 'outlook.timezone="UTC"' },
      body: JSON.stringify({
        schedules: [schedule],
        startTime: { dateTime: data.from.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
        endTime: { dateTime: data.to.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
        availabilityViewInterval: 30,
      }),
    }) as { value?: Array<{ scheduleItems?: Array<{ start?: { dateTime?: string }; end?: { dateTime?: string } }> }> };
    return (result.value?.[0]?.scheduleItems || []).map((item) => ({ start: new Date(`${item.start?.dateTime || ""}Z`), end: new Date(`${item.end?.dateTime || ""}Z`) })).filter((item) => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()));
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
    const target = this.credentials.calendarId ? `${this.basePath()}/calendars/${encodeURIComponent(this.credentials.calendarId)}/events` : `${this.basePath()}/events`;
    const result = await this.request(target, {
      method: "POST",
      body: JSON.stringify({
        subject: input.title,
        body: { contentType: "text", content: input.description || "" },
        start: { dateTime: input.start.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
        end: { dateTime: input.end.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
        attendees: input.attendeeEmail ? [{ emailAddress: { address: input.attendeeEmail, name: input.attendeeName }, type: "required" }] : [],
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
      }),
    }) as any;
    return { externalEventId: result.id, meetingUrl: result.onlineMeeting?.joinUrl || result.onlineMeetingUrl };
  }

  async updateEvent(externalEventId: string, input: CalendarEventInput): Promise<CalendarEventResult> {
    const target = this.credentials.calendarId
      ? `${this.basePath()}/calendars/${encodeURIComponent(this.credentials.calendarId)}/events/${encodeURIComponent(externalEventId)}`
      : `${this.basePath()}/events/${encodeURIComponent(externalEventId)}`;
    const result = await this.request(target, {
      method: "PATCH",
      body: JSON.stringify({
        subject: input.title,
        body: { contentType: "text", content: input.description || "" },
        start: { dateTime: input.start.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
        end: { dateTime: input.end.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
        attendees: input.attendeeEmail ? [{ emailAddress: { address: input.attendeeEmail, name: input.attendeeName }, type: "required" }] : [],
      }),
    }) as any;
    return { externalEventId: result.id || externalEventId, meetingUrl: result.onlineMeeting?.joinUrl || result.onlineMeetingUrl };
  }

  async deleteEvent(externalEventId: string): Promise<void> {
    const target = this.credentials.calendarId
      ? `${this.basePath()}/calendars/${encodeURIComponent(this.credentials.calendarId)}/events/${encodeURIComponent(externalEventId)}`
      : `${this.basePath()}/events/${encodeURIComponent(externalEventId)}`;
    await this.request(target, { method: "DELETE" });
  }
}
