import { domainEventBus } from "./domainEventBus.js";
import { MailServerService } from "./mailServerService.js";

let registered = false;

export function registerBookingEmailNotificationBridge() {
  if (registered) return;
  registered = true;

  domainEventBus.subscribe("booking.created", async (event) => {
    const bookingId = typeof event.payload.bookingId === "string" ? event.payload.bookingId : "";
    if (!bookingId) return;
    try {
      await MailServerService.sendBookingConfirmation(event.organizationId, bookingId);
    } catch (error) {
      await MailServerService.recordBookingEmailFailure(event.organizationId, bookingId).catch(() => undefined);
      console.error(JSON.stringify({
        level: "error",
        event: "booking.confirmation_email_failed",
        organizationId: event.organizationId,
        bookingId,
        message: (error as Error).message.replace(/[\r\n]+/g, " ").slice(0, 200),
      }));
    }
  });
}
