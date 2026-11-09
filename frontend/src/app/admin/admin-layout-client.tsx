"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ChevronRight,
  LayoutGrid,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { applyUserTheme } from "@/lib/user-theme";

type Organization = { id: string; name: string };

const navigation = [
  {
    label: "Arbeitsbereich",
    items: [
      ["/admin", "Übersicht"],
      ["/admin/employees", "Mitarbeiter"],
      ["/admin/support-coverage", "Arbeitszeiten"],
      ["/admin/support-teams", "Teams & SLA"],
      ["/admin/scheduling", "Termine"],
      ["/admin/notifications", "Benachrichtigungen"],
    ],
  },
  {
    label: "KI & Wissen",
    items: [
      ["/admin/configuration", "Assistenten & Widget"],
      ["/admin/agents", "Agent-Versionen"],
      ["/admin/knowledge", "Knowledge Intelligence"],
      ["/admin/answer-quality", "Antwortqualität"],
      ["/admin/actions", "AI Actions"],
      ["/admin/support-automations", "Automationen"],
    ],
  },
  {
    label: "Auswertung",
    items: [
      ["/admin/analytics", "Analytics"],
      ["/admin/support-analytics", "Support-Analytics"],
    ],
  },
  {
    label: "Verwaltung",
    items: [
      ["/admin/settings/ai-models", "KI-Modelle & Routing"],
      ["/admin/settings/api-keys", "Provider-Schlüssel"],
      ["/admin/settings/quotas", "Kontingente"],
      ["/admin/settings/organization", "Organisation"],
      ["/admin/settings/roles", "Rollen & Rechte"],
      ["/admin/settings/security", "Sicherheit"],
      ["/admin/settings/github", "GitHub"],
      ["/admin/settings/audit-log", "Änderungsprotokoll"],
      ["/admin/platform-security", "Plattform-Sicherheit"],
      ["/admin/mail-server", "Mailserver"],
      ["/admin/integrations", "Integrationen"],
      ["/admin/integrations/zendesk-inbound", "Zendesk Inbound"],
    ],
  },
];

export default function AdminLayoutClient({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const embedded = pathname === "/admin/configuration";
  const currentSection =
    navigation
      .flatMap((group) => group.items)
      .find(([href]) => href === pathname)?.[1] ?? "Plattformverwaltung";
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.get("/admin/organizations"), api.get("/auth/me")])
      .then(([{ data }, me]) => {
        if (!active) return;
        applyUserTheme(me.data.user.themePreferences);
        setOrganizations(data);
        const id =
          data.find(
            (org: Organization) =>
              org.id === localStorage.getItem("active_org_id"),
          )?.id ||
          data[0]?.id ||
          "";
        if (id) localStorage.setItem("active_org_id", id);
        setSelected(id);
        setReady(true);
      })
      .catch((e) => {
        if (active)
          setError(
            e.response?.data?.error ||
              "Verwaltung konnte nicht geladen werden.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  if (error || !ready)
    return (
      <main className="rv-app-surface rv-admin-state">
        <section className="rv-app-state-card">
          <span className="rv-app-state-icon">
            <ShieldCheck size={26} aria-hidden="true" />
          </span>
          <p className="rv-app-eyebrow">PLATTFORMVERWALTUNG</p>
          <h1>
            {error
              ? "Verwaltung nicht verfügbar"
              : "Arbeitsbereich wird vorbereitet"}
          </h1>
          <p role={error ? "alert" : "status"}>
            {error || "Berechtigung und Organisationen werden geprüft …"}
          </p>
          {error && (
            <Link href="/" className="rv-app-button">
              <ArrowLeft size={16} aria-hidden="true" /> Zum
              Mitarbeiter-Dashboard
            </Link>
          )}
        </section>
      </main>
    );

  return (
    <div
      className={`rv-admin-shell ${embedded ? "rv-admin-shell--embedded" : "rv-app-surface"}`}
    >
      {!embedded && (
        <aside className="rv-admin-sidebar">
          <Link href="/admin" className="rv-app-brand">
            <span aria-hidden="true">R</span>
            <div>
              Relvona<small>Plattformverwaltung</small>
            </div>
          </Link>
          <nav className="rv-admin-navigation" aria-label="Plattformverwaltung">
            {navigation.map((group) => (
              <div className="rv-admin-nav-group" key={group.label}>
                <p>{group.label}</p>
                {group.items.map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    aria-current={pathname === href ? "page" : undefined}
                  >
                    <span className="rv-admin-nav-dot" aria-hidden="true" />
                    {label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="rv-admin-sidebar-footer">
            <Link href="/">
              <ArrowUpRight size={17} aria-hidden="true" />{" "}
              Mitarbeiter-Dashboard
            </Link>
          </div>
        </aside>
      )}
      <div className="rv-admin-body">
        <header className="rv-app-surface rv-admin-toolbar">
          <div className="rv-admin-breadcrumb">
            <Link href="/admin" aria-label="Zur Verwaltungsübersicht">
              <LayoutGrid size={18} aria-hidden="true" />
            </Link>
            <ChevronRight size={14} aria-hidden="true" />
            <span>{currentSection}</span>
          </div>
          <label className="rv-admin-organization">
            <Building2 size={17} aria-hidden="true" />
            <span className="sr-only">Organisation</span>
            <select
              value={selected}
              onChange={(event) => {
                localStorage.setItem("active_org_id", event.target.value);
                setSelected(event.target.value);
              }}
            >
              {!organizations.length && (
                <option value="">Keine Organisation</option>
              )}
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <Link href="/profile" className="rv-admin-profile">
            <UserRound size={18} aria-hidden="true" />
            <span>Profil</span>
          </Link>
        </header>
        {selected ? (
          <div
            key={selected}
            className={`rv-admin-content ${embedded ? "rv-admin-content--embedded" : ""}`}
          >
            {children}
          </div>
        ) : (
          <div className="rv-admin-empty">
            <Settings2 size={30} aria-hidden="true" />
            <h1>Keine Organisation vorhanden</h1>
            <p>
              Für die Organisationsverwaltung muss zuerst eine Organisation
              eingerichtet werden.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
