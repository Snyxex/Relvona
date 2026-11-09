import Link from "next/link";
import { ArrowRight, Settings2 } from "lucide-react";
const sections = [
  [
    "settings/ai-models",
    "KI-Modelle & Routing",
    "Primärmodell, Fallback, Antwortlänge und Routingregeln.",
  ],
  [
    "configuration",
    "Assistenten & Integrationen",
    "KI-Anbieter, Modellprofile, Widget und Mitarbeiter verwalten.",
  ],
  [
    "settings/api-keys",
    "Provider-Schlüssel",
    "Verschlüsselte Zugangsdaten hinterlegen und testen.",
  ],
  [
    "settings/quotas",
    "Kontingente",
    "Tokenbudget und Anfragen pro Minute begrenzen.",
  ],
  [
    "settings/organization",
    "Organisation",
    "Supportkontakt, Sprachen und Erscheinungsbild.",
  ],
  [
    "settings/roles",
    "Rollen & Rechte",
    "Berechtigungen für Admins, Agents und Viewer verwalten.",
  ],
  [
    "settings/security",
    "Sicherheit",
    "Sitzungen, Schlüsselrotation und Administrator-IP-Adressen.",
  ],
  [
    "settings/audit-log",
    "Änderungsprotokoll",
    "Administrative Änderungen nachvollziehen.",
  ],
  [
    "platform-security",
    "Plattform-Sicherheit & 2FA",
    "Zwei-Faktor-Authentifizierung global verpflichten, empfehlen oder freiwillig lassen.",
  ],
];
export default function AdminPage() {
  return (
    <main>
      <p className="rv-app-eyebrow">PLATTFORMADMINISTRATOR</p>
      <h1 className="mt-3">Software verwalten</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Zentrale Verwaltung aller Organisationen. Änderungen gelten für die oben
        ausgewählte Organisation.
      </p>
      <div className="rv-admin-home-grid">
        {sections.map(([href, title, text]) => (
          <Link
            key={href}
            href={`/admin/${href}`}
            className="rv-admin-home-card"
          >
            <span>
              <Settings2 size={22} aria-hidden="true" />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
            <small>
              Bereich öffnen <ArrowRight size={14} aria-hidden="true" />
            </small>
          </Link>
        ))}
      </div>
    </main>
  );
}
