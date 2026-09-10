import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings } from "../db/extendedCustomerExperienceSchema.js";

export type SchedulingRole = "owner" | "admin" | "agent";

export class BookingAccessService {
  static assignedUserIdForRole(role: SchedulingRole, userId: string): string | undefined {
    return role === "agent" ? userId : undefined;
  }

  static async assertAccessible(data: {
    organizationId: string;
    bookingId: string;
    role: SchedulingRole;
    userId: string;
  }) {
    const [booking] = await db.select().from(bookings).where(and(
      eq(bookings.organizationId, data.organizationId),
      eq(bookings.id, data.bookingId),
      data.role === "agent" ? eq(bookings.assignedUserId, data.userId) : undefined,
    )).limit(1);
    if (!booking) throw new Error("Booking not found");
    return booking;
  }
}
