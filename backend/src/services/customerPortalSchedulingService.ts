import { and, asc, eq } from "drizzle-orm";
import { withTenantTransaction } from "../db/index.js";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { bookings, meetingTypes } from "../db/extendedCustomerExperienceSchema.js";
import type { CustomerPortalSessionContext } from "./customerPortalService.js";
import { SchedulingService } from "./schedulingService.js";

async function tenantCall<T>(organizationId: string, work: () => Promise<T>) {
  return withDatabaseTenantContext(async () => { setDatabaseTenant(organizationId); return work(); });
}

export class CustomerPortalSchedulingService {
  static async list(session: CustomerPortalSessionContext) {
    return withTenantTransaction(session.organizationId, async (tx) => tx.select({ booking: bookings, meetingType: meetingTypes })
      .from(bookings)
      .innerJoin(meetingTypes, eq(bookings.meetingTypeId, meetingTypes.id))
      .where(and(eq(bookings.organizationId, session.organizationId), eq(bookings.customerId, session.customerId)))
      .orderBy(asc(bookings.startsAt)));
  }

  private static async ownedBooking(session: CustomerPortalSessionContext, bookingId: string) {
    return withTenantTransaction(session.organizationId, async (tx) => {
      const [booking] = await tx.select().from(bookings).where(and(eq(bookings.organizationId, session.organizationId), eq(bookings.id, bookingId), eq(bookings.customerId, session.customerId))).limit(1);
      if (!booking) throw new Error("Booking not found");
      return booking;
    });
  }

  static async slots(session: CustomerPortalSessionContext, bookingId: string, from: Date, to: Date) {
    const booking = await this.ownedBooking(session, bookingId);
    return tenantCall(session.organizationId, () => SchedulingService.findAvailableSlots({ organizationId: session.organizationId, meetingTypeId: booking.meetingTypeId, assignedUserId: booking.assignedUserId || undefined, from, to, limit: 12 }));
  }

  static async reschedule(session: CustomerPortalSessionContext, bookingId: string, startsAt: Date, timezone: string) {
    const booking = await this.ownedBooking(session, bookingId);
    if (booking.status === "cancelled") throw new Error("Booking not found");
    return tenantCall(session.organizationId, () => SchedulingService.rescheduleBooking({ organizationId: session.organizationId, bookingId, startsAt, timezone, actorType: "customer", expectedCustomerId: session.customerId }));
  }

  static async cancel(session: CustomerPortalSessionContext, bookingId: string) {
    const booking = await this.ownedBooking(session, bookingId);
    if (booking.status === "cancelled") throw new Error("Booking not found");
    return tenantCall(session.organizationId, () => SchedulingService.cancelBooking({ organizationId: session.organizationId, bookingId, actorType: "customer", expectedCustomerId: session.customerId }));
  }
}
