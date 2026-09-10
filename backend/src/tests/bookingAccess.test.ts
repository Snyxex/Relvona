import { BookingAccessService } from "../services/bookingAccessService.js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const userId = "11111111-1111-4111-8111-111111111111";

assert(BookingAccessService.assignedUserIdForRole("agent", userId) === userId, "Agents must be scoped to their own assigned user id");
assert(BookingAccessService.assignedUserIdForRole("owner", userId) === undefined, "Owners must keep organization-wide booking visibility");
assert(BookingAccessService.assignedUserIdForRole("admin", userId) === undefined, "Admins must keep organization-wide booking visibility");

console.log("Booking access policy tests passed");
