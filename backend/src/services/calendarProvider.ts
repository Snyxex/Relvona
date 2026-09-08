export type CalendarBusyInterval = { start: Date; end: Date };
export type CalendarEventInput = {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  timezone: string;
  attendeeEmail?: string;
  attendeeName?: string;
};

export type CalendarEventResult = {
  externalEventId: string;
  meetingUrl?: string;
};

/**
 * Scheduling owns policy and booking state. Providers only expose calendar I/O.
 * Google Calendar and Microsoft Graph adapters can implement this contract later
 * without coupling the AI agent or booking service to either SDK.
 */
export interface CalendarProvider {
  listBusyIntervals(data: { from: Date; to: Date }): Promise<CalendarBusyInterval[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEventResult>;
  updateEvent(externalEventId: string, input: CalendarEventInput): Promise<CalendarEventResult>;
  deleteEvent(externalEventId: string): Promise<void>;
}
