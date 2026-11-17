"use client";

import {
  ArrowLeft,
  Building2,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { adminGroups, findAdminDestination } from "@/lib/admin-navigation";
import { api } from "@/lib/api";
import { applyUserTheme } from "@/lib/user-theme";

type Organization = { id: string; name: string };

export default function AdminLayoutClient({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selected, setSelected] = useState("");
  const [userName, setUserName] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  const current = findAdminDestination(pathname);
  const query = search.trim().toLocaleLowerCase("de-DE");
  const groups = adminGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.label} ${item.label} ${item.description}`
          .toLocaleLowerCase("de-DE")
          .includes(query),
      ),
    }))
    .filter((group) => group.items.length);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A manual retry must rerun the cancellable bootstrap.
  useEffect(() => {
    let active = true;
    setError("");
    setReady(false);
    Promise.all([api.get("/admin/organizations"), api.get("/auth/me")])
      .then(([{ data }, me]) => {
        if (!active) return;
        applyUserTheme(me.data.user.themePreferences);
        setUserName(me.data.user.name || "Administrator");
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
  }, [attempt]);

  useEffect(() => {
    if (!menuOpen) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButton.current?.focus();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [menuOpen]);

  return (
    <div className="rv-admin">
      <a className="rv-admin-skip" href="#admin-content">
        Zum Inhalt springen
      </a>
      <aside className="rv-admin-sidebar" aria-label="Plattformverwaltung">
        <div className="rv-admin-brand-row">
          <Link
            href="/admin"
            className="rv-admin-brand"
            onClick={() => setMenuOpen(false)}
          >
            <span className="rv-admin-brand-mark" aria-hidden="true">
              R
            </span>
            <span>
              <strong>Relvona</strong>
              <small>Plattformverwaltung</small>
            </span>
          </Link>
          <button
            type="button"
            ref={menuButton}
            className="rv-admin-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="admin-navigation"
            aria-label={menuOpen ? "Navigation schließen" : "Navigation öffnen"}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        <div
          id="admin-navigation"
          className={`rv-admin-navigation ${menuOpen ? "is-open" : ""}`}
        >
          <label className="rv-admin-nav-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Bereich finden …"
              aria-label="Verwaltungsbereiche filtern"
            />
          </label>
          <nav aria-label="Admin-Bereiche">
            <Link
              href="/admin"
              className="rv-admin-nav-link"
              aria-current={pathname === "/admin" ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              <LayoutDashboard size={17} aria-hidden="true" />
              Übersicht
            </Link>
            {groups.map((group) => (
              <div className="rv-admin-nav-group" key={group.label}>
                <p>{group.label}</p>
                {group.items.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="rv-admin-nav-link"
                    aria-current={current?.href === href ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            ))}
            {!groups.length && (
              <p className="rv-admin-nav-empty" role="status">
                Kein Bereich gefunden. Versuche einen anderen Suchbegriff.
              </p>
            )}
          </nav>
          <div className="rv-admin-sidebar-footer">
            <Link href="/">
              <ArrowLeft size={16} aria-hidden="true" />
              Mitarbeiter-Dashboard
            </Link>
            <span>
              <ShieldCheck size={14} aria-hidden="true" />
              Administratorbereich
            </span>
          </div>
        </div>
      </aside>
      <div className="rv-admin-workspace">
        <header className="rv-admin-toolbar">
          <nav
            aria-label="Brotkrümelnavigation"
            className="rv-admin-breadcrumb"
          >
            <Link href="/admin">Verwaltung</Link>
            <ChevronRight size={14} aria-hidden="true" />
            <span aria-current="page">{current?.label || "Übersicht"}</span>
          </nav>
          <div className="rv-admin-toolbar-actions">
            <label className="rv-admin-organization">
              <Building2 size={17} aria-hidden="true" />
              <span className="sr-only">Organisation</span>
              <select
                aria-label="Aktive Organisation"
                value={selected}
                disabled={!ready || !organizations.length}
                onChange={(event) => {
                  localStorage.setItem("active_org_id", event.target.value);
                  setSelected(event.target.value);
                }}
              >
                {!organizations.length && (
                  <option value="">
                    {ready
                      ? "Keine Organisation"
                      : "Organisation wird geladen …"}
                  </option>
                )}
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <Link
              href="/profile"
              className="rv-admin-profile"
              aria-label={
                userName ? `Profil von ${userName}` : "Profil-Einstellungen"
              }
              title={userName || "Profil-Einstellungen"}
            >
              {userName ? (
                userName.charAt(0).toLocaleUpperCase("de-DE")
              ) : (
                <UserRound size={18} />
              )}
            </Link>
          </div>
        </header>
        <div id="admin-content" className="rv-admin-content" tabIndex={-1}>
          {error ? (
            <main className="rv-admin-state">
              <ShieldCheck size={32} aria-hidden="true" />
              <h1>Verwaltung nicht verfügbar</h1>
              <p role="alert">{error}</p>
              <button type="button" onClick={() => setAttempt(attempt + 1)}>
                Erneut versuchen
              </button>
              <Link href="/">Zum Mitarbeiter-Dashboard</Link>
            </main>
          ) : !ready ? (
            <main className="rv-admin-state" aria-busy="true">
              <span className="rv-admin-loading-mark" aria-hidden="true">
                R
              </span>
              <h1>Verwaltung wird vorbereitet</h1>
              <p role="status">
                Berechtigung und Organisationen werden geladen …
              </p>
            </main>
          ) : selected ? (
            <div key={selected} className="rv-admin-page">
              {children}
            </div>
          ) : (
            <main className="rv-admin-state">
              <Building2 size={32} aria-hidden="true" />
              <h1>Noch keine Organisation</h1>
              <p>Erstelle zunächst eine Organisation über die Registrierung.</p>
              <Link href="/">Zum Mitarbeiter-Dashboard</Link>
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
