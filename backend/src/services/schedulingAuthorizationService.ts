import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizationMembers } from "../db/schema.js";

export class SchedulingAuthorizationService {
  static async assertSchedulableMember(organizationId: string, userId: string | undefined) {
    if (!userId) return;
    const [membership] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ))
      .limit(1);

    if (!membership || !["owner", "admin", "agent"].includes(membership.role)) {
      throw new Error("Assigned user is not a schedulable organization member");
    }
  }
}
