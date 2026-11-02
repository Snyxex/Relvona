"use client";

import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import { MessageSquare } from "lucide-react";

export type ConversationTag = { id: string; name: string };
export type InboxAgent = { id: string; name?: string | null; email?: string | null; presence?: string };
export type InboxConversation = {
  id: string;
  organizationId?: string;
  customer?: { name?: string | null; email?: string | null };
  priority?: string | null;
  state?: string | null;
  assignedAgentId?: string | null;
  detectedLanguage?: string | null;
  sentiment?: string | null;
  tags?: ConversationTag[];
};
export type InboxMessage = {
  id: string;
  conversationId: string;
  createdAt: string;
  content: string;
  senderType: string;
  senderName?: string | null;
};
export type InboxTimelineEvent = {
  id: string;
  createdAt: string;
  eventType: string;
  payload?: { to?: string };
};
export type InboxHandoff = {
  requestedPriority?: string;
  reason?: string;
  aiConfidence?: number | null;
  lastAiAttempt?: string | null;
  claimedAt?: string | null;
  createdAt: string;
};
export type InboxSuggestion = {
  conversationId: string;
  content: string;
  sources: string[];
};
type SetString = Dispatch<SetStateAction<string>>;
type Props = {
  conversationsList: InboxConversation[];
  selectedConv: InboxConversation | null;
  convMessages: InboxMessage[];
  inboxTags: ConversationTag[];
  inboxAgents: InboxAgent[];
  inboxTimeline: InboxTimelineEvent[];
  inboxHandoff: InboxHandoff | null;
  suggestion: InboxSuggestion | null;
  setSuggestion: Dispatch<SetStateAction<InboxSuggestion | null>>;
  suggesting: boolean;
  connected: boolean;
  translations: Record<string, string>;
  preferredLanguage: string;
  currentUserId?: string;
  agentPresence: string;
  agentMsgInput: string;
  setAgentMsgInput: SetString;
  internalNoteInput: string;
  setInternalNoteInput: SetString;
  inboxState: string;
  setInboxState: SetString;
  inboxPriority: string;
  setInboxPriority: SetString;
  inboxAgentId: string;
  setInboxAgentId: SetString;
  inboxFrom: string;
  setInboxFrom: SetString;
  inboxTo: string;
  setInboxTo: SetString;
  inboxSearch: string;
  setInboxSearch: SetString;
  inboxSort: string;
  setInboxSort: SetString;
  inboxTagId: string;
  setInboxTagId: SetString;
  handleSelectConversation: (conversation: InboxConversation) => Promise<void>;
  handleSendAgentMessage: FormEventHandler<HTMLFormElement>;
  handleResolveConversation: (conversationId: string) => Promise<void>;
  handleTranslateMessage: (message: InboxMessage) => Promise<void>;
  handlePresenceChange: (presence: string) => Promise<void>;
  handleInboxAction: (path: string, body?: Record<string, unknown>) => Promise<void>;
  handleToggleConversationTag: (tag: ConversationTag) => Promise<void>;
  handleAddInternalNote: () => Promise<void>;
  handleSuggestReply: () => Promise<void>;
};

/** Presentational inbox; socket and API ownership remain in the controller. */
export default function ConversationsWorkspace({
  conversationsList, selectedConv, convMessages, agentMsgInput, setAgentMsgInput, internalNoteInput, setInternalNoteInput, inboxState, setInboxState, inboxPriority, setInboxPriority, inboxAgentId, setInboxAgentId, inboxFrom, setInboxFrom, inboxTo, setInboxTo, inboxSearch, setInboxSearch, inboxSort, setInboxSort, inboxTags, inboxAgents, agentPresence, inboxTagId, setInboxTagId, inboxTimeline, inboxHandoff, suggestion, setSuggestion, suggesting, connected, translations, preferredLanguage, currentUserId, handleSelectConversation, handleSendAgentMessage, handleResolveConversation, handleTranslateMessage, handlePresenceChange, handleInboxAction, handleToggleConversationTag, handleAddInternalNote, handleSuggestReply
}: Props) {
  return (
    <div className="rv-inbox-layout h-full flex gap-4 max-w-7xl mx-auto">
                <div className="rv-inbox-list w-1/3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                  <div className="p-3 border-b border-slate-800 space-y-2">
                    <div className="font-semibold text-sm">Conversation-Inbox</div>
                    <input
                      value={inboxSearch}
                      onChange={(event) => setInboxSearch(event.target.value)}
                      placeholder="Kunde, E-Mail, ID oder Nachricht"
                      aria-label="Unterhaltungen durchsuchen"
                      className="w-full rounded bg-slate-800 px-2 py-1.5 text-xs"
                    />
                    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                      <span>Meine Presence</span>
                      <select
                        value={agentPresence}
                        onChange={(event) =>
                          void handlePresenceChange(event.target.value)
                        }
                        className="rounded bg-slate-800 p-1 text-[10px] text-slate-200"
                      >
                        <option>ONLINE</option>
                        <option>AWAY</option>
                        <option>OFFLINE</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <select
                        value={inboxState}
                        onChange={(event) => setInboxState(event.target.value)}
                        className="rounded bg-slate-800 p-1 text-[10px]"
                      >
                        <option value="">Alle Status</option>
                        {[
                          "AI_ACTIVE",
                          "NEEDS_HUMAN",
                          "WAITING_FOR_AGENT",
                          "AGENT_ACTIVE",
                          "WAITING_FOR_CUSTOMER",
                          "RESOLVED",
                          "CLOSED",
                        ].map((state) => (
                          <option key={state}>{state}</option>
                        ))}
                      </select>
                      <select
                        value={inboxAgentId}
                        onChange={(event) => setInboxAgentId(event.target.value)}
                        className="rounded bg-slate-800 p-1 text-[10px]"
                      >
                        <option value="">Alle Agenten</option>
                        <option value="unassigned">Nicht zugewiesen</option>
                        {inboxAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name || agent.email}
                          </option>
                        ))}
                      </select>
                      <select
                        value={inboxTagId}
                        onChange={(event) => setInboxTagId(event.target.value)}
                        className="rounded bg-slate-800 p-1 text-[10px]"
                      >
                        <option value="">Alle Tags</option>
                        {inboxTags.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={inboxFrom}
                        onChange={(event) => setInboxFrom(event.target.value)}
                        aria-label="Von Datum"
                        className="rounded bg-slate-800 p-1 text-[10px]"
                      />
                      <input
                        type="date"
                        value={inboxTo}
                        onChange={(event) => setInboxTo(event.target.value)}
                        aria-label="Bis Datum"
                        className="rounded bg-slate-800 p-1 text-[10px]"
                      />
                      <select
                        value={inboxPriority}
                        onChange={(event) => setInboxPriority(event.target.value)}
                        className="rounded bg-slate-800 p-1 text-[10px]"
                      >
                        <option value="">Alle Prioritäten</option>
                        {["LOW", "NORMAL", "HIGH", "URGENT"].map((priority) => (
                          <option key={priority}>{priority}</option>
                        ))}
                      </select>
                      <select
                        value={inboxSort}
                        onChange={(event) => setInboxSort(event.target.value)}
                        className="col-span-2 rounded bg-slate-800 p-1 text-[10px]"
                      >
                        <option value="newest">Neueste Aktivität</option>
                        <option value="oldest_waiting">
                          Älteste wartende Anfrage
                        </option>
                        <option value="priority">Höchste Priorität</option>
                        <option value="sla_risk">SLA-Risiko</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
                    {conversationsList.length === 0 && (
                      <div className="rv-inbox-empty" role="status">
                        <MessageSquare size={24} aria-hidden="true" />
                        <strong>Keine Unterhaltungen gefunden</strong>
                        <p>Neue Anfragen und passende Suchergebnisse erscheinen hier.</p>
                      </div>
                    )}
                    {conversationsList.map((conv) => (
                      <button
                        type="button"
                        key={conv.id}
                        onClick={() => handleSelectConversation(conv)}
                        aria-current={selectedConv?.id === conv.id ? "true" : undefined}
                        className={`w-full p-3 text-left transition-colors flex flex-col gap-1 ${
                          selectedConv?.id === conv.id
                            ? "bg-blue-950/60 border-l-4 border-blue-500"
                            : "hover:bg-slate-800/40"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-semibold text-slate-200">
                            {conv.customer?.name || "Visitor"}
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
                              conv.priority === "URGENT"
                                ? "text-red-400"
                                : conv.priority === "HIGH"
                                  ? "text-amber-400"
                                  : "text-slate-400"
                            }`}
                          >
                            {conv.priority || "NORMAL"}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                              conv.state === "WAITING_FOR_AGENT"
                                ? "bg-amber-950 text-amber-400 border border-amber-800"
                                : conv.state === "RESOLVED"
                                  ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                                  : "bg-blue-950 text-blue-400 border border-blue-800"
                            }`}
                          >
                            {conv.state}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                          <span>Lang: {conv.detectedLanguage}</span>
                          {conv.sentiment && (
                            <span
                              className={`capitalize font-bold ${
                                conv.sentiment === "frustrated"
                                  ? "text-red-400 font-extrabold animate-pulse"
                                  : conv.sentiment === "negative"
                                    ? "text-amber-400"
                                    : conv.sentiment === "positive"
                                      ? "text-emerald-400"
                                      : "text-slate-400"
                              }`}
                            >
                              ● {conv.sentiment}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
    
                <div className="rv-inbox-detail w-2/3 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                  {selectedConv ? (
                    <>
                      <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-200">
                            {selectedConv.customer?.name}
                          </h3>
                          <p className="text-[10px] text-slate-400">
                            {selectedConv.customer?.email}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={selectedConv.priority || "NORMAL"}
                            onChange={(event) =>
                              void handleInboxAction("priority", {
                                priority: event.target.value,
                              })
                            }
                            className="rounded bg-slate-800 px-2 text-[10px]"
                          >
                            {["LOW", "NORMAL", "HIGH", "URGENT"].map(
                              (priority) => (
                                <option key={priority}>{priority}</option>
                              ),
                            )}
                          </select>
                          <select
                            value={selectedConv.assignedAgentId || ""}
                            onChange={(event) =>
                              void handleInboxAction("assignment", {
                                agentId: event.target.value || null,
                              })
                            }
                            className="max-w-32 rounded bg-slate-800 px-2 text-[10px]"
                          >
                            <option value="">Unassign</option>
                            {inboxAgents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.name || agent.email}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              void handleInboxAction("assignment", {
                                agentId: currentUserId,
                              })
                            }
                            className="rounded bg-violet-700 px-2 py-1 text-xs"
                          >
                            Assign to me
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleResolveConversation(selectedConv.id)
                            }
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded"
                          >
                            Mark Resolved
                          </button>
                        </div>
                      </div>
    
                      {inboxTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 border-b border-slate-800 bg-slate-900 px-3 py-2">
                          {inboxTags.map((tag) => {
                            const active = (selectedConv.tags || []).some(
                              (item: ConversationTag) => item.id === tag.id,
                            );
                            return (
                              <button
                                type="button"
                                key={tag.id}
                                onClick={() => void handleToggleConversationTag(tag)}
                                className={`rounded px-2 py-1 text-[10px] ${
                                  active
                                    ? "bg-blue-700 text-white"
                                    : "bg-slate-800 text-slate-400 hover:text-white"
                                }`}
                              >
                                {active ? "✓ " : "+ "}
                                {tag.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/40">
                        {inboxHandoff && (
                          <section className="rounded-lg border border-amber-800/80 bg-amber-950/35 p-3 text-xs text-amber-100">
                            <div className="flex items-center justify-between gap-2">
                              <strong>Human Handoff</strong>
                              <span className="rounded bg-amber-900/70 px-1.5 py-0.5 font-mono text-[10px]">
                                {inboxHandoff.requestedPriority}
                              </span>
                            </div>
                            <p className="mt-1">Grund: {inboxHandoff.reason}</p>
                            {inboxHandoff.aiConfidence !== null && (
                              <p className="mt-1">
                                AI Confidence:{" "}
                                {Math.round(Number(inboxHandoff.aiConfidence) * 100)}%
                              </p>
                            )}
                            {inboxHandoff.lastAiAttempt && (
                              <p className="mt-2 rounded bg-slate-950/50 p-2 text-slate-300">
                                Letzter AI-Versuch: {inboxHandoff.lastAiAttempt}
                              </p>
                            )}
                            <p className="mt-2 text-[10px] text-amber-300">
                              {inboxHandoff.claimedAt
                                ? `Übernommen am ${new Date(inboxHandoff.claimedAt).toLocaleString()}`
                                : `Eskaliert am ${new Date(inboxHandoff.createdAt).toLocaleString()}`}
                            </p>
                          </section>
                        )}
                        {inboxTimeline.length > 0 && (
                          <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs">
                            <h4 className="font-semibold text-slate-200">
                              Activity Timeline
                            </h4>
                            <ol className="mt-2 space-y-2 border-l border-slate-700 pl-3">
                              {inboxTimeline.slice(-8).map((event) => {
                                const labels: Record<string, string> = {
                                  handoff_requested: "Human handoff requested",
                                  assignment_changed: "Assignment changed",
                                  unassigned: "Conversation unassigned",
                                  priority_changed: "Priority changed",
                                  tags_changed: "Tags updated",
                                  internal_note_added: "Internal note added",
                                  status_changed: "Status changed",
                                  auto_closed: "Automatically closed",
                                };
                                return (
                                  <li
                                    key={event.id}
                                    className="relative text-slate-400 before:absolute before:-left-[17px] before:top-1.5 before:size-1.5 before:rounded-full before:bg-blue-400"
                                  >
                                    <span className="text-slate-200">
                                      {labels[event.eventType] || event.eventType}
                                    </span>
                                    {event.payload?.to && (
                                      <span className="ml-1 text-slate-500">
                                        → {event.payload.to}
                                      </span>
                                    )}
                                    <time className="ml-2 text-[10px] text-slate-500">
                                      {new Date(event.createdAt).toLocaleString()}
                                    </time>
                                  </li>
                                );
                              })}
                            </ol>
                          </section>
                        )}
                        {convMessages.map((m) => (
                          <div
                            key={m.id}
                            className={`max-w-md p-3 rounded-xl text-xs ${
                              m.senderType === "internal_note"
                                ? "bg-amber-950/60 text-amber-100 mr-auto rounded border border-amber-800"
                                : m.senderType === "customer"
                                  ? "bg-blue-600 text-white ml-auto rounded-br-none"
                                  : m.senderType === "agent"
                                    ? "bg-purple-700 text-white ml-auto rounded-br-none"
                                    : "bg-slate-800 text-slate-200 mr-auto rounded-bl-none border border-slate-700"
                            }`}
                          >
                            <div className="font-semibold text-[10px] opacity-75 mb-1">
                              {m.senderName || m.senderType}
                            </div>
                            <p className="leading-relaxed">{m.content}</p>
                            {m.senderType === "customer" && (
                              <div className="mt-2 border-t border-white/15 pt-2">
                                {translations[m.id] ? (
                                  <p className="leading-relaxed text-white/80">
                                    <span className="mr-1 text-[10px] font-semibold uppercase opacity-70">
                                      {preferredLanguage}
                                    </span>
                                    {translations[m.id]}
                                  </p>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleTranslateMessage(m)}
                                    className="text-[10px] font-medium text-blue-200 hover:text-white"
                                  >
                                    Übersetzen ({preferredLanguage.toUpperCase()})
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
    
                      <div className="p-3 border-t border-slate-800 text-xs space-y-2">
                        <span>
                          {connected
                            ? "Live verbunden"
                            : "Live-Verbindung unterbrochen"}
                        </span>
                        <button
                          type="button"
                          disabled={suggesting}
                          className="ml-3 text-blue-300 disabled:opacity-50"
                          onClick={handleSuggestReply}}
                        >
                          {suggesting
                            ? "Vorschlag wird erstellt …"
                            : "Antwortvorschlag erstellen"}
                        </button>
                        {suggestion?.conversationId === selectedConv.id &&
                          suggestion && (
                            <div className="rounded bg-slate-800 p-3 space-y-2">
                              <p>{suggestion.content}</p>
                              <p>{suggestion.sources.join(" · ")}</p>
                              <button
                                type="button"
                                className="mr-3 text-blue-300"
                                onClick={() => {
                                  setAgentMsgInput(suggestion.content);
                                  setSuggestion(null);
                                }}
                              >
                                Übernehmen und bearbeiten
                              </button>
                              <button
                                type="button"
                                onClick={() => setSuggestion(null)}
                              >
                                Verwerfen
                              </button>
                            </div>
                          )}
                      </div>
                      <div className="border-t border-amber-900/70 bg-amber-950/20 p-3">
                        <p className="mb-2 text-[10px] font-semibold uppercase text-amber-300">
                          Interne Notiz — wird niemals an den Kunden gesendet
                        </p>
                        <div className="flex gap-2">
                          <input
                            value={internalNoteInput}
                            onChange={(event) =>
                              setInternalNoteInput(event.target.value)
                            }
                            className="flex-1 rounded border border-amber-800 bg-slate-900 px-3 py-2 text-xs"
                            placeholder="Notiz für das Support-Team"
                          />
                          <button
                            type="button"
                            onClick={handleAddInternalNote}
                            className="rounded bg-amber-700 px-3 text-xs font-semibold"
                          >
                            Notiz speichern
                          </button>
                        </div>
                      </div>
                      <form
                        onSubmit={handleSendAgentMessage}
                        className="p-3 border-t border-slate-800 bg-slate-900 flex gap-2"
                      >
                        <input
                          type="text"
                          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                          placeholder="Type agent response..."
                          value={agentMsgInput}
                          onChange={(e) => setAgentMsgInput(e.target.value)}
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded"
                        >
                          Send Reply
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                      Wähle links eine Unterhaltung aus, um sie zu bearbeiten.
                    </div>
                  )}
                </div>
              </div>
  );
}
