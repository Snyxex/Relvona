"use client";

import { memo, useMemo, useState } from "react";
import { Search, ShieldCheck, UserRound, Users } from "lucide-react";
import {
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "./workspace-primitives";

type Agent = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  presence?: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Inhaber",
  admin: "Administrator",
  agent: "Support-Agent",
};

function AgentsTab({ agents }: { agents: Agent[] }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-DE");
    if (!needle) return agents;
    return agents.filter((agent) =>
      [agent.name, agent.email, agent.role].some((value) =>
        value?.toLocaleLowerCase("de-DE").includes(needle),
      ),
    );
  }, [agents, query]);

  return (
    <div className="rv-section-page">
      <WorkspaceHeader
        eyebrow="TEAM"
        title="Support-Team"
        description="Mitarbeiter, die Kundenanfragen übernehmen und betreuen können."
      >
        <span className="rv-section-count">
          <Users size={15} aria-hidden="true" />
          {agents.length} Mitglieder
        </span>
      </WorkspaceHeader>
      <WorkspacePanel>
        <div className="rv-directory-toolbar">
          <label className="rv-section-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Team durchsuchen</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, E-Mail oder Rolle suchen"
            />
          </label>
          <span className="rv-directory-result">{matches.length} Treffer</span>
        </div>
        {matches.length > 0 ? (
          <div className="rv-agent-list">
            {matches.map((agent) => {
              const presence = agent.presence?.toUpperCase() ?? "";
              const isOnline = presence === "ONLINE";
              const label =
                presence === "ONLINE"
                  ? "Online"
                  : presence === "AWAY"
                    ? "Abwesend"
                    : presence === "OFFLINE"
                      ? "Offline"
                      : "Status unbekannt";
              return (
                <article className="rv-agent-row" key={agent.id}>
                  <span className="rv-directory-avatar">
                    <UserRound size={19} aria-hidden="true" />
                  </span>
                  <div className="rv-agent-identity">
                    <h2>{agent.name || "Unbenannter Mitarbeiter"}</h2>
                    <p>{agent.email || "Keine E-Mail hinterlegt"}</p>
                  </div>
                  <div className="rv-agent-badges">
                    <span className="rv-section-tag">
                      <ShieldCheck size={13} aria-hidden="true" />
                      {ROLE_LABELS[agent.role ?? ""] ??
                        agent.role ??
                        "Mitglied"}
                    </span>
                    <span
                      className={`rv-section-presence ${isOnline ? "rv-online" : ""}`}
                    >
                      <i aria-hidden="true" />
                      {label}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <WorkspaceEmpty
            icon={UserRound}
            title={
              query
                ? "Keine passenden Mitarbeiter"
                : "Noch keine Support-Agenten"
            }
            description={
              query
                ? "Versuche andere Suchbegriffe."
                : "Füge Mitglieder mit der Rolle Agent, Admin oder Inhaber hinzu."
            }
          />
        )}
      </WorkspacePanel>
      <div className="rv-section-note">
        <ShieldCheck size={17} aria-hidden="true" />
        Mitgliederrechte werden weiterhin serverseitig geprüft. Der angezeigte
        Präsenzstatus kommt aus den vorhandenen Agentendaten.
      </div>
    </div>
  );
}

export default memo(AgentsTab);
