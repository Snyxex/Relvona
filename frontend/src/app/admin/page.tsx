import { ArrowUpRight, ChevronRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { adminGroups } from "@/lib/admin-navigation";

const shortcuts = [
  "/admin/employees",
  "/admin/configuration",
  "/admin/support-analytics",
  "/admin/integrations",
];

export default function AdminPage() {
  return (
    <main className="rv-admin-home">
      <header className="rv-admin-home-heading">
        <div>
          <h1>Alles für guten Support.</h1>
          <p>Dein zentraler Arbeitsplatz für Team, KI und Organisation.</p>
        </div>
        <span className="rv-admin-role">
          <ShieldCheck size={15} aria-hidden="true" />
          Plattformadministrator
        </span>
      </header>
      <section aria-labelledby="admin-shortcuts-title">
        <h2 id="admin-shortcuts-title" className="rv-admin-section-title">
          Direkt zum Arbeitsbereich
        </h2>
        <div className="rv-admin-shortcuts">
          {shortcuts.map((href) => {
            const group = adminGroups.find((entry) =>
              entry.items.some((item) => item.href === href),
            );
            const item = group?.items.find((entry) => entry.href === href);
            if (!item) return null;
            const Icon = item.icon;
            return (
              <Link
                href={href}
                key={href}
                className={`rv-admin-shortcut rv-admin-tone-${group?.tone}`}
              >
                <span className="rv-admin-shortcut-top">
                  <span className="rv-admin-icon">
                    <Icon size={21} aria-hidden="true" />
                  </span>
                  <ArrowUpRight size={18} aria-hidden="true" />
                </span>
                <h3>{item.label}</h3>
                <p>{item.description}</p>
              </Link>
            );
          })}
        </div>
      </section>
      <div className="rv-admin-scope-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          Der Organisationswechsel oben bestimmt, welche Organisation du
          verwaltest. Plattform-Sicherheit und Mailserver gelten plattformweit.
        </p>
      </div>
      <div className="rv-admin-directory">
        {adminGroups.map((group) => (
          <section
            key={group.label}
            className={`rv-admin-directory-group rv-admin-tone-${group.tone}`}
          >
            <header>
              <h2>{group.label}</h2>
              <p>{group.description}</p>
            </header>
            <div>
              {group.items.map(({ href, label, description, icon: Icon }) => (
                <Link
                  href={href}
                  key={href}
                  className="rv-admin-directory-link"
                >
                  <span className="rv-admin-directory-icon">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
