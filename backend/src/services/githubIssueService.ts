import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizationSettings, tickets } from "../db/schema.js";
import { decryptSecret } from "../utils/crypto.js";
import { logger } from "../observability/logger.js";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isValidGitHubRepository(value: unknown): value is string {
  return typeof value === "string" && repositoryPattern.test(value);
}

type GitHubIssueResponse = { number?: unknown; html_url?: unknown; message?: unknown };

/** Sends only the ticket content to GitHub; customer identity fields are never exported. */
export class GitHubIssueService {
  static async createForEscalation(ticket: typeof tickets.$inferSelect): Promise<void> {
    const [settings] = await db
      .select({
        enabled: organizationSettings.githubIssuesEnabled,
        repository: organizationSettings.githubRepository,
        tokenEncrypted: organizationSettings.githubTokenEncrypted,
      })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, ticket.organizationId))
      .limit(1);

    const token = decryptSecret(settings?.tokenEncrypted);
    if (!settings?.enabled || !isValidGitHubRepository(settings.repository) || !token) return;

    try {
      const response = await fetch(`https://api.github.com/repos/${settings.repository}/issues`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "SupportAI-Platform",
        },
        body: JSON.stringify({
          title: `[SupportAI #${ticket.ticketNumber}] ${ticket.subject}`.slice(0, 240),
          body: [
            "Automatisch von SupportAI aus einer KI-Eskalation erstellt.",
            "",
            `Interne Ticketnummer: ${ticket.ticketNumber}`,
            `Priorität: ${ticket.priority}`,
            `Tags: ${Array.isArray(ticket.tags) ? ticket.tags.join(", ") || "-" : "-"}`,
            "",
            "## Beschreibung",
            ticket.description || "Keine Beschreibung vorhanden.",
          ].join("\n"),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => ({})) as GitHubIssueResponse;
      if (!response.ok || typeof payload.number !== "number" || typeof payload.html_url !== "string") {
        throw new Error(typeof payload.message === "string" ? payload.message.slice(0, 500) : `GitHub returned HTTP ${response.status}`);
      }
      await db.update(tickets).set({
        githubIssueNumber: payload.number,
        githubIssueUrl: payload.html_url,
        githubIssueError: null,
        updatedAt: new Date(),
      }).where(and(eq(tickets.id, ticket.id), eq(tickets.organizationId, ticket.organizationId)));
      logger.info("github.issue.created", { organizationId: ticket.organizationId, ticketId: ticket.id, githubIssueNumber: payload.number });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown GitHub issue creation error";
      await db.update(tickets).set({ githubIssueError: message, updatedAt: new Date() }).where(and(eq(tickets.id, ticket.id), eq(tickets.organizationId, ticket.organizationId)));
      logger.error("github.issue.creation_failed", { organizationId: ticket.organizationId, ticketId: ticket.id, message });
    }
  }
}
