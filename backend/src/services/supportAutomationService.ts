import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, withTenantTransaction } from "../db/index.js";
import { organizationMembers, tickets, users } from "../db/schema.js";
import { ticketCaseEvents, ticketCaseMetadata } from "../db/extendedCustomerExperienceSchema.js";
import { supportAutomationRules, supportAutomationRuns } from "../db/supportAutomationSchema.js";
import { notifications } from "../db/notificationSchema.js";
import { TicketCaseService } from "./ticketCaseService.js";
import { domainEventBus } from "./domainEventBus.js";
import { automationEventKey, parseAutomationRule, ruleMatches, type AutomationTrigger, type AutomationRuleInput, type AutomationAction } from "./supportAutomationPolicy.js";

const MAX_RULES = 100;
type Ticket = typeof tickets.$inferSelect;

export class SupportAutomationService {
  static async list(organizationId: string) {
    return db.select().from(supportAutomationRules)
      .where(eq(supportAutomationRules.organizationId, organizationId))
      .orderBy(desc(supportAutomationRules.updatedAt)).limit(MAX_RULES);
  }
  static async save(organizationId: string, actorUserId: string, raw: unknown, id?: string) {
    const rule = parseAutomationRule(raw);
    for (const action of rule.actions) {
      if (action.type !== "assign_agent") continue;
      const [member] = await db.select({ id: organizationMembers.id }).from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, action.userId),
          eq(organizationMembers.status, "active"), eq(users.status, "active"),
          inArray(organizationMembers.role, ["owner", "admin", "agent"]))).limit(1);
      if (!member) throw new Error("Invalid assigned agent");
    }
    if (id) {
      const [existing] = await db.update(supportAutomationRules)
        .set({ ...rule, updatedAt: new Date() })
        .where(and(eq(supportAutomationRules.organizationId, organizationId), eq(supportAutomationRules.id, id))).returning();
      if (!existing) throw new Error("Rule not found");
      return existing;
    }
    const [total] = await db.select({ total: sql<number>`count(*)::int` }).from(supportAutomationRules)
      .where(eq(supportAutomationRules.organizationId, organizationId));
    if (Number(total.total) >= MAX_RULES) throw new Error("Rule limit reached");
    const [created] = await db.insert(supportAutomationRules)
      .values({ organizationId, createdBy: actorUserId, ...rule }).returning();
    return created;
  }
  static async remove(organizationId: string, id: string) {
    const [deleted] = await db.delete(supportAutomationRules)
      .where(and(eq(supportAutomationRules.organizationId, organizationId), eq(supportAutomationRules.id, id)))
      .returning({ id: supportAutomationRules.id });
    return Boolean(deleted);
  }
  static async history(organizationId: string, limit = 50) {
    return db.select({
      id: supportAutomationRuns.id, ticketId: supportAutomationRuns.ticketId, ruleId: supportAutomationRuns.ruleId,
      trigger: supportAutomationRuns.trigger, actionsApplied: supportAutomationRuns.actionsApplied,
      createdAt: supportAutomationRuns.createdAt, ruleName: supportAutomationRules.name,
    }).from(supportAutomationRuns).innerJoin(supportAutomationRules,
      and(eq(supportAutomationRuns.ruleId, supportAutomationRules.id), eq(supportAutomationRules.organizationId, organizationId)))
      .where(eq(supportAutomationRuns.organizationId, organizationId))
      .orderBy(desc(supportAutomationRuns.createdAt)).limit(Math.min(Math.max(Math.trunc(limit), 1), 100));
  }
  static async preview(organizationId: string, ticketId: string, raw: unknown) {
    const rule = parseAutomationRule(raw);
    const [ticket] = await db.select().from(tickets)
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId))).limit(1);
    if (!ticket) throw new Error("Ticket not found");
    const idle = ticket.updatedAt && Date.now() - ticket.updatedAt.getTime() >= (rule.idleMinutes || 0) * 60_000;
    const eligible = rule.trigger !== "ticket.idle" || (idle && ["open", "pending", "in_progress"].includes(ticket.status));
    return { matched: Boolean(eligible && ruleMatches(rule.conditions, ticket)), actions: rule.actions,
      dryRun: true, ticketId, note: "Simulation führt keine Aktionen aus und verschickt keine Benachrichtigungen." };
  }
  private static async applyRule(org: string, rule: typeof supportAutomationRules.$inferSelect,
    ticketId: string, eventKey: string, trigger: AutomationTrigger) {
    const priorityAction = rule.actions.find(a => a.type === "set_priority");
    const priorityPolicy = priorityAction?.type === "set_priority"
      ? await TicketCaseService.policyFor(org, priorityAction.priority) : null;
    const result = await withTenantTransaction(org, async tx => {
      const [ticket] = await tx.select().from(tickets)
        .where(and(eq(tickets.organizationId, org), eq(tickets.id, ticketId))).for("update").limit(1);
      if (!ticket || !ruleMatches(rule.conditions, ticket)) return null;
      if (trigger === "ticket.idle") {
        if (!["open", "pending", "in_progress"].includes(ticket.status)
          || !rule.idleMinutes || !ticket.updatedAt
          || ticket.updatedAt.getTime() + rule.idleMinutes * 60_000 > Date.now()) return null;
      }
      const [claim] = await tx.insert(supportAutomationRuns)
        .values({ organizationId: org, ruleId: rule.id, ticketId, eventKey, trigger, actionsApplied: [] })
        .onConflictDoNothing({ target: [supportAutomationRuns.ruleId, supportAutomationRuns.ticketId, supportAutomationRuns.eventKey] })
        .returning({ id: supportAutomationRuns.id });
      if (!claim) return null;
      const patch: Partial<Pick<Ticket, "priority" | "assignedAgentId" | "tags">> = {};
      const applied: string[] = [];
      let nextPriority = ticket.priority;
      let nextAssigned = ticket.assignedAgentId;
      let tags = Array.isArray(ticket.tags) ? ticket.tags.filter((t): t is string => typeof t === "string") : [];
      for (const action of rule.actions) {
        if (action.type === "set_priority" && action.priority !== nextPriority) {
          nextPriority = action.priority; patch.priority = action.priority; applied.push(action.type);
        } else if (action.type === "assign_agent" && !nextAssigned) {
          const [eligible] = await tx.select({ id: organizationMembers.id }).from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(eq(organizationMembers.organizationId, org), eq(organizationMembers.userId, action.userId),
              eq(organizationMembers.status, "active"), eq(users.status, "active"),
              inArray(organizationMembers.role, ["owner", "admin", "agent"]))).limit(1);
          if (eligible) {
            nextAssigned = action.userId; patch.assignedAgentId = action.userId; applied.push(action.type);
          }
        } else if (action.type === "add_tag" && !tags.includes(action.tag) && tags.length < 20) {
          tags = [...tags, action.tag]; patch.tags = tags; applied.push(action.type);
        } else if (action.type === "notify_admins") {
          const admins = await tx.select({ userId: organizationMembers.userId }).from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(eq(organizationMembers.organizationId, org), eq(organizationMembers.status, "active"),
              eq(users.status, "active"), inArray(organizationMembers.role, ["owner", "admin"])));
          for (const admin of admins) {
            await tx.insert(notifications).values({
              organizationId: org, recipientUserId: admin.userId, type: "automation.rule", severity: "info",
              title: `Automation: ${rule.name}`, message: `Ticket #${ticket.ticketNumber}: ${action.message}`,
              resourceType: "ticket", resourceId: ticket.id,
              dedupeKey: `automation:${rule.id}:${ticket.id}:${eventKey}`,
            }).onConflictDoNothing({ target: [notifications.organizationId, notifications.recipientUserId, notifications.dedupeKey] });
          }
          if (admins.length) applied.push(action.type);
        }
      }
      if (Object.keys(patch).length) {
        await tx.update(tickets).set({ ...patch, updatedAt: new Date() })
          .where(and(eq(tickets.organizationId, org), eq(tickets.id, ticketId)));
      }
      if (nextPriority !== ticket.priority && priorityPolicy) {
        const [caseRow] = await tx.select().from(ticketCaseMetadata)
          .where(and(eq(ticketCaseMetadata.organizationId, org), eq(ticketCaseMetadata.ticketId, ticketId))).limit(1);
        if (caseRow) {
          const started = ticket.createdAt || new Date();
          await tx.update(ticketCaseMetadata).set({
            firstResponseDueAt: caseRow.firstRespondedAt ? caseRow.firstResponseDueAt : new Date(started.getTime() + priorityPolicy.firstResponseMinutes * 60_000),
            resolutionDueAt: new Date(started.getTime() + priorityPolicy.resolutionMinutes * 60_000), updatedAt: new Date(),
          }).where(and(eq(ticketCaseMetadata.organizationId, org), eq(ticketCaseMetadata.ticketId, ticketId)));
        }
        await tx.insert(ticketCaseEvents).values({ organizationId: org, ticketId, type: "automation.priority_changed",
          fromValue: ticket.priority, toValue: nextPriority, metadata: { ruleId: rule.id } });
      }
      if (nextAssigned !== ticket.assignedAgentId) {
        await tx.insert(ticketCaseEvents).values({ organizationId: org, ticketId, type: "automation.assignment_changed",
          fromValue: ticket.assignedAgentId, toValue: nextAssigned, metadata: { ruleId: rule.id } });
      }
      await tx.update(supportAutomationRuns).set({ actionsApplied: applied })
        .where(and(eq(supportAutomationRuns.organizationId, org), eq(supportAutomationRuns.id, claim.id)));
      return { ticket, changedFields: Object.keys(patch), nextPriority, nextAssigned };
    });
    if (result?.changedFields.length) {
      // Other bridges may deliver a webhook; the automation bridge ignores source=automation_rules.
      await domainEventBus.emit({
        type: "ticket.updated", organizationId: org, conversationId: result.ticket.conversationId || undefined,
        payload: { ...result.ticket, priority: result.nextPriority, assignedAgentId: result.nextAssigned,
          changedFields: result.changedFields, source: "automation_rules" },
      });
    }
    return Boolean(result);
  }

  static async handleTicketEvent(org: string, ticketId: string, trigger: "ticket.created" | "ticket.updated",
    occurredAt: Date, source?: string) {
    if (source === "automation_rules") return { applied: 0 };
    const rules = await db.select().from(supportAutomationRules)
      .where(and(eq(supportAutomationRules.organizationId, org), eq(supportAutomationRules.enabled, true),
        eq(supportAutomationRules.trigger, trigger))).limit(MAX_RULES);
    let applied = 0;
    for (const rule of rules) {
      try {
        if (await this.applyRule(org, rule, ticketId, automationEventKey(trigger, ticketId, occurredAt), trigger)) applied++;
      } catch (error) {
        console.error(JSON.stringify({ event: "automation.rule_failed", organizationId: org, ruleId: rule.id,
          ticketId, message: error instanceof Error ? error.message.slice(0, 200) : "Unknown" }));
      }
    }
    return { applied };
  }
  static async sweepIdle(organizationId: string) {
    const rules = await db.select().from(supportAutomationRules)
      .where(and(eq(supportAutomationRules.organizationId, organizationId),
        eq(supportAutomationRules.enabled, true), eq(supportAutomationRules.trigger, "ticket.idle"))).limit(MAX_RULES);
    let applied = 0;
    for (const rule of rules) {
      if (!rule.idleMinutes) continue;
      const threshold = new Date(Date.now() - rule.idleMinutes * 60_000);
      const due = await db.select({ id: tickets.id, updatedAt: tickets.updatedAt }).from(tickets)
        .where(and(eq(tickets.organizationId, organizationId),
          inArray(tickets.status, ["open", "pending", "in_progress"]), lte(tickets.updatedAt, threshold)))
        .orderBy(tickets.updatedAt).limit(150);
      for (const ticket of due) {
        try {
          if (await this.applyRule(organizationId, rule, ticket.id,
            automationEventKey("ticket.idle", ticket.id, ticket.updatedAt || new Date(0)), "ticket.idle")) applied++;
        } catch (error) {
          console.error(JSON.stringify({ event: "automation.idle_rule_failed", organizationId, ruleId: rule.id,
            ticketId: ticket.id, message: error instanceof Error ? error.message.slice(0,200) : "Unknown" }));
        }
      }
    }
    return { applied };
  }
}
