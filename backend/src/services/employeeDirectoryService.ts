import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { employeeDirectory } from "../db/employeeDirectorySchema.js";
import { agentPresence, conversationActivities, conversationHandoffs, conversations, organizationMembers } from "../db/schema.js";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanOptional(value: unknown, max: number) {
  const normalized = clean(value, max);
  return normalized || null;
}

function validEmail(value: string | null) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export type EmployeeDirectoryInput = {
  userId?: string | null;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  skills?: string[];
  notes?: string | null;
  aiVisible?: boolean;
  exposeEmailToCustomer?: boolean;
  exposePhoneToCustomer?: boolean;
  allowDirectHandoff?: boolean;
  enabled?: boolean;
};

export class EmployeeDirectoryService {
  static async list(organizationId: string) {
    return db.select().from(employeeDirectory)
      .where(eq(employeeDirectory.organizationId, organizationId))
      .orderBy(employeeDirectory.displayName);
  }

  static async listAssignableMembers(organizationId: string) {
    return db.select({ userId: organizationMembers.userId, role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "active")));
  }

  static normalize(input: EmployeeDirectoryInput) {
    const displayName = clean(input.displayName, 120);
    const email = cleanOptional(input.email, 254)?.toLowerCase() || null;
    if (!displayName) throw new Error("Name ist erforderlich.");
    if (!validEmail(email)) throw new Error("Ungültige E-Mail-Adresse.");
    const skills = Array.isArray(input.skills)
      ? input.skills.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 30)
      : [];
    return {
      userId: input.userId || null,
      displayName,
      email,
      phone: cleanOptional(input.phone, 60),
      department: cleanOptional(input.department, 120),
      jobTitle: cleanOptional(input.jobTitle, 120),
      skills,
      notes: cleanOptional(input.notes, 1000),
      aiVisible: input.aiVisible !== false,
      exposeEmailToCustomer: input.exposeEmailToCustomer === true,
      exposePhoneToCustomer: input.exposePhoneToCustomer === true,
      allowDirectHandoff: input.allowDirectHandoff === true,
      enabled: input.enabled !== false,
    };
  }

  static async create(organizationId: string, input: EmployeeDirectoryInput) {
    const data = this.normalize(input);
    if (data.userId) await this.assertMember(organizationId, data.userId);
    const [created] = await db.insert(employeeDirectory).values({ organizationId, ...data }).returning();
    return created;
  }

  static async update(organizationId: string, id: string, input: EmployeeDirectoryInput) {
    const data = this.normalize(input);
    if (data.userId) await this.assertMember(organizationId, data.userId);
    const [updated] = await db.update(employeeDirectory).set({ ...data, updatedAt: new Date() })
      .where(and(eq(employeeDirectory.organizationId, organizationId), eq(employeeDirectory.id, id))).returning();
    if (!updated) throw new Error("Mitarbeiter wurde nicht gefunden.");
    return updated;
  }

  static async remove(organizationId: string, id: string) {
    const [removed] = await db.delete(employeeDirectory)
      .where(and(eq(employeeDirectory.organizationId, organizationId), eq(employeeDirectory.id, id))).returning({ id: employeeDirectory.id });
    if (!removed) throw new Error("Mitarbeiter wurde nicht gefunden.");
  }

  static async searchForAI(organizationId: string, query: string) {
    const term = query.trim().slice(0, 120);
    const matches = await db.select().from(employeeDirectory).where(and(
      eq(employeeDirectory.organizationId, organizationId),
      eq(employeeDirectory.enabled, true),
      eq(employeeDirectory.aiVisible, true),
      term ? or(
        ilike(employeeDirectory.displayName, `%${term}%`),
        ilike(employeeDirectory.department, `%${term}%`),
        ilike(employeeDirectory.jobTitle, `%${term}%`),
      ) : undefined,
    )).limit(10);

    const result = [];
    for (const employee of matches) {
      const [presence] = employee.userId
        ? await db.select({ status: agentPresence.status }).from(agentPresence).where(and(eq(agentPresence.organizationId, organizationId), eq(agentPresence.userId, employee.userId))).limit(1)
        : [];
      result.push({
        id: employee.id,
        name: employee.displayName,
        department: employee.department,
        jobTitle: employee.jobTitle,
        skills: employee.skills,
        email: employee.exposeEmailToCustomer ? employee.email : undefined,
        phone: employee.exposePhoneToCustomer ? employee.phone : undefined,
        canDirectHandoff: Boolean(employee.allowDirectHandoff && employee.userId),
        availability: employee.userId ? (presence?.status || "OFFLINE") : "CONTACT_ONLY",
      });
    }
    return result;
  }

  static async requestDirectHandoff(organizationId: string, conversationId: string, employeeId: string) {
    const [employee] = await db.select().from(employeeDirectory).where(and(
      eq(employeeDirectory.organizationId, organizationId),
      eq(employeeDirectory.id, employeeId),
      eq(employeeDirectory.enabled, true),
      eq(employeeDirectory.aiVisible, true),
    )).limit(1);
    if (!employee || !employee.userId || !employee.allowDirectHandoff) throw new Error("Dieser Mitarbeiter kann nicht direkt verbunden werden.");
    await this.assertMember(organizationId, employee.userId);

    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.organizationId, organizationId),
      eq(conversations.id, conversationId),
    )).limit(1);
    if (!conversation) throw new Error("Konversation wurde nicht gefunden.");

    await db.update(conversations).set({
      state: "WAITING_FOR_AGENT",
      assignedAgentId: employee.userId,
      updatedAt: new Date(),
    }).where(and(eq(conversations.organizationId, organizationId), eq(conversations.id, conversationId)));

    await db.insert(conversationHandoffs).values({
      organizationId,
      conversationId,
      reason: `Direkte Mitarbeiteranfrage: ${employee.displayName}`,
      requestedPriority: "NORMAL",
    });
    await db.insert(conversationActivities).values({
      organizationId,
      conversationId,
      eventType: "direct_employee_handoff_requested",
      payload: { employeeId: employee.id, userId: employee.userId, displayName: employee.displayName },
    });

    return { employeeId: employee.id, name: employee.displayName, status: "WAITING_FOR_AGENT" };
  }

  private static async assertMember(organizationId: string, userId: string) {
    const [member] = await db.select({ id: organizationMembers.id }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, "active"),
    )).limit(1);
    if (!member) throw new Error("Der verknüpfte Benutzer gehört nicht zur Organisation.");
  }
}
