"use client";

import { memo, useMemo, useState } from "react";
import { Mail, Search, UserRound, Users } from "lucide-react";
import {
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "./workspace-primitives";

type Customer = {
  id: string;
  name?: string | null;
  email?: string | null;
  externalId?: string | null;
  createdAt: string;
};

function CustomersTab({ customers }: { customers: Customer[] }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-DE");
    if (!needle) return customers;
    return customers.filter((customer) =>
      [customer.name, customer.email, customer.externalId].some((value) =>
        value?.toLocaleLowerCase("de-DE").includes(needle),
      ),
    );
  }, [customers, query]);

  return (
    <div className="rv-section-page">
      <WorkspaceHeader
        eyebrow="KUNDEN"
        title="Kundenverzeichnis"
        description="Kundenprofile aus Widget-Sitzungen und verknüpften Support-Unterhaltungen."
      >
        <span className="rv-section-count">
          <Users size={15} aria-hidden="true" />
          {customers.length} Kunden
        </span>
      </WorkspaceHeader>
      <WorkspacePanel>
        <div className="rv-directory-toolbar">
          <label className="rv-section-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Kunden durchsuchen</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nach Name, E-Mail oder externer ID suchen"
            />
          </label>
          <span className="rv-directory-result">{matches.length} Treffer</span>
        </div>
        {matches.length > 0 ? (
          <div className="rv-directory-grid">
            {matches.map((customer) => (
              <article key={customer.id} className="rv-directory-card">
                <div className="rv-directory-identity">
                  <span className="rv-directory-avatar">
                    <UserRound size={19} aria-hidden="true" />
                  </span>
                  <div>
                    <h2>{customer.name || "Website-Besucher"}</h2>
                    <p>
                      <Mail size={13} aria-hidden="true" />
                      {customer.email || "Keine E-Mail hinterlegt"}
                    </p>
                  </div>
                </div>
                <dl className="rv-directory-meta">
                  <div>
                    <dt>Externe ID</dt>
                    <dd title={customer.externalId ?? ""}>
                      {customer.externalId || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Erstellt</dt>
                    <dd>
                      {new Date(customer.createdAt).toLocaleDateString("de-DE")}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <WorkspaceEmpty
            icon={UserRound}
            title={
              query ? "Keine passenden Kunden" : "Noch keine Kundenprofile"
            }
            description={
              query
                ? "Versuche eine andere Suche."
                : "Neue Widget-Besucher erscheinen hier nach Erstellung eines Kundenprofils."
            }
          />
        )}
      </WorkspacePanel>
    </div>
  );
}

export default memo(CustomersTab);
