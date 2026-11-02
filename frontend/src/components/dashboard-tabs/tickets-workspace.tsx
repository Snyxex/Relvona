"use client";

import { useMemo, useState } from "react";
import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import { Search } from "lucide-react";
import { TICKET_STATUS_OPTIONS, ticketStatusLabel, ticketStatusTone } from "@/lib/support-status";

export type SupportTicket = {
  id: string;
  ticketNumber: number | string;
  subject: string;
  status: string;
  priority?: string | null;
  description?: string | null;
  createdAt: string;
  tags?: string[];
  customer?: { name?: string | null; email?: string | null } | null;
  conversationId?: string | null;
  githubIssueUrl?: string | null;
  githubIssueNumber?: number | string | null;
  githubIssueError?: string | null;
};

export type TicketComment = {
  id: string;
  content: string;
  author?: { name?: string | null } | null;
};

type Props = {
  ticketsList: SupportTicket[];
  selectedTicket: SupportTicket | null;
  ticketCommentsList: TicketComment[];
  commentInput: string;
  setCommentInput: Dispatch<SetStateAction<string>>;
  handleSelectTicket: (ticket: SupportTicket) => void;
  handleOpenTicketConversation: () => void;
  handleTicketStatusChange: (status: string) => void;
  handleAddTicketComment: FormEventHandler<HTMLFormElement>;
};

/** Ticket table and detail pane. Search and status filters are owned by this tab. */
export default function TicketsWorkspace({
  ticketsList, selectedTicket, ticketCommentsList, commentInput,
  setCommentInput, handleSelectTicket, handleOpenTicketConversation,
  handleTicketStatusChange, handleAddTicketComment,
}: Props) {
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatus, setTicketStatus] = useState("");
  const visibleTickets = useMemo(() => ticketsList.filter((ticket) => {
    if (ticketStatus && ticket.status !== ticketStatus) return false;
    const query = ticketSearch.trim().toLocaleLowerCase("de-DE");
    if (!query) return true;
    return [ticket.subject, ticket.ticketNumber, ticket.customer?.name, ticket.customer?.email]
      .some((value) => String(value ?? "").toLocaleLowerCase("de-DE").includes(query));
  }), [ticketsList, ticketSearch, ticketStatus]);

  return (
    <div className="rv-ticket-workspace space-y-4 max-w-7xl mx-auto">
                <div>
                  <h1 className="text-xl font-bold text-white">
                    Support-Tickets
                  </h1>
                  <p className="mt-1 text-xs text-slate-400">
                    KI-Eskalationen werden automatisch als offene Tickets in diese
                    Warteschlange übernommen.
                  </p>
                </div>
    
                <div className="rv-ticket-filters">
                  <label className="rv-section-search">
                    <Search className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Tickets suchen</span>
                    <input type="search" value={ticketSearch}
                      onChange={(event) => setTicketSearch(event.target.value)}
                      placeholder="Betreff, Ticketnummer oder Kunden suchen" />
                  </label>
                  <label className="rv-ticket-filter-status">
                    <span className="sr-only">Nach Ticketstatus filtern</span>
                    <select value={ticketStatus} onChange={(event) => setTicketStatus(event.target.value)}>
                      <option value="">Alle Status</option>
                      {TICKET_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <span className="rv-directory-result">{visibleTickets.length} Tickets</span>
                </div>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="rv-ticket-table bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] font-semibold">
                        <tr>
                          <th className="p-3"># Ticket</th>
                          <th className="p-3">Subject</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Priority</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {visibleTickets.length === 0 && (
                          <tr>
                            <td
                              colSpan={6}
                              className="p-8 text-center text-slate-500"
                            >
                              {ticketsList.length === 0
                                ? "Noch keine Tickets vorhanden."
                                : "Keine Tickets entsprechen den gewählten Filtern."}
                            </td>
                          </tr>
                        )}
                        {visibleTickets.map((tk) => (
                          <tr
                            key={tk.id}
                            className={`hover:bg-slate-800/40 ${
                              selectedTicket?.id === tk.id ? "bg-blue-950/20" : ""
                            }`}
                          >
                            <td className="p-3 font-mono font-bold text-blue-400">
                              #{tk.ticketNumber}
                            </td>
                            <td className="p-3 font-medium text-slate-200">
                              <button
                                type="button"
                                onClick={() => handleSelectTicket(tk)}
                                aria-current={selectedTicket?.id === tk.id ? "true" : undefined}
                                className="rv-ticket-open text-left font-semibold"
                              >
                                {tk.subject}
                              </button>
                              {Array.isArray(tk.tags) &&
                                tk.tags.includes("ai-escalation") && (
                                  <span className="mt-1 inline-block rounded border border-violet-800 bg-violet-950/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-300">
                                    KI-Eskalation
                                  </span>
                                )}
                            </td>
                            <td className="p-3">
                              {tk.customer?.name || "Visitor"}
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                  tk.priority === "urgent"
                                    ? "bg-red-950 text-red-400 border border-red-800"
                                    : tk.priority === "high"
                                      ? "bg-amber-950 text-amber-400 border border-amber-800"
                                      : "bg-slate-800 text-slate-300"
                                }`}
                              >
                                {tk.priority}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className={`rv-ticket-status-pill rv-ticket-status-pill--${ticketStatusTone(tk.status)} px-2 py-0.5 rounded text-[10px] border uppercase font-semibold`}>
                                {ticketStatusLabel(tk.status)}
                              </span>
                            </td>
                            <td className="p-3 text-slate-500">
                              {new Date(tk.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <aside className="rv-ticket-details rounded-xl border border-slate-800 bg-slate-900 p-4">
                    {selectedTicket ? (
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] font-semibold uppercase text-blue-400">
                            Ticket #{selectedTicket.ticketNumber}
                          </p>
                          <h2 className="mt-1 text-sm font-semibold text-white">
                            {selectedTicket.subject}
                          </h2>
                        </div>
                        <p className="whitespace-pre-wrap text-xs leading-5 text-slate-300">
                          {selectedTicket.description ||
                            "Keine zusätzliche Beschreibung."}
                        </p>
                        {selectedTicket.githubIssueUrl && (
                          <a
                            href={selectedTicket.githubIssueUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex text-xs font-medium text-blue-400 hover:text-blue-300"
                          >
                            GitHub Issue #{selectedTicket.githubIssueNumber} öffnen
                          </a>
                        )}
                        {selectedTicket.githubIssueError && (
                          <p className="rounded border border-amber-800 bg-amber-950/30 p-2 text-xs text-amber-200">
                            GitHub-Synchronisierung fehlgeschlagen:{" "}
                            {selectedTicket.githubIssueError}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {selectedTicket.conversationId && (
                            <button
                              type="button"
                              onClick={handleOpenTicketConversation}
                              className="rounded border border-violet-800 bg-violet-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-300 hover:bg-violet-950"
                            >
                              Unterhaltung öffnen
                            </button>
                          )}
                          {selectedTicket.status !== "in_progress" && (
                            <button
                              type="button"
                              onClick={() =>
                                handleTicketStatusChange("in_progress")
                              }
                              className="rounded bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500"
                            >
                              Bearbeiten
                            </button>
                          )}
                          {selectedTicket.status !== "resolved" && (
                            <button
                              type="button"
                              onClick={() => handleTicketStatusChange("resolved")}
                              className="rounded border border-emerald-800 bg-emerald-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-950"
                            >
                              Lösen
                            </button>
                          )}
                        </div>
                        <div className="border-t border-slate-800 pt-3">
                          <p className="mb-2 text-[10px] font-semibold uppercase text-slate-500">
                            Interne Kommentare
                          </p>
                          {ticketCommentsList.length ? (
                            ticketCommentsList.map((comment) => (
                              <div
                                key={comment.id}
                                className="mb-2 rounded bg-slate-800/70 p-2 text-[11px] text-slate-300"
                              >
                                <p>{comment.content}</p>
                                <p className="mt-1 text-[10px] text-slate-500">
                                  {comment.author?.name || "Support"}
                                </p>
                              </div>
                            ))
                          ) : (
                            <p className="mb-2 text-xs text-slate-500">
                              Noch keine Kommentare.
                            </p>
                          )}
                          <form
                            onSubmit={handleAddTicketComment}
                            className="mt-3 flex gap-2"
                          >
                            <input
                              value={commentInput}
                              onChange={(event) =>
                                setCommentInput(event.target.value)
                              }
                              maxLength={2000}
                              placeholder="Interne Notiz hinzufügen…"
                              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-blue-500"
                            />
                            <button
                              type="submit"
                              className="rounded bg-slate-700 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-600"
                            >
                              Notiz
                            </button>
                          </form>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs leading-5 text-slate-500">
                        Wähle ein Ticket, um Anfrage, Status und interne Kommentare
                        zu sehen.
                      </p>
                    )}
                  </aside>
                </div>
              </div>
  );
}
