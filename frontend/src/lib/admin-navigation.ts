import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  Clock3,
  FileClock,
  Gauge,
  GitBranch,
  KeyRound,
  Mail,
  Plug,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  UsersRound,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type AdminDestination = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const adminGroups: {
  label: string;
  description: string;
  tone: "blue" | "violet" | "mint" | "slate";
  items: AdminDestination[];
}[] = [
  {
    label: "Support & Team",
    description: "Menschen, Abläufe und Servicequalität aufeinander abstimmen.",
    tone: "blue",
    items: [
      {
        href: "/admin/employees",
        label: "Mitarbeiter",
        description: "Kontakte, Zuständigkeiten und KI-Routing verwalten.",
        icon: Users,
      },
      {
        href: "/admin/support-teams",
        label: "Teams & SLA",
        description: "Teams organisieren und Eskalationen festlegen.",
        icon: UsersRound,
      },
      {
        href: "/admin/support-coverage",
        label: "Arbeitszeiten",
        description: "Erreichbarkeit und Supportzeiten planen.",
        icon: Clock3,
      },
      {
        href: "/admin/support-automations",
        label: "Automationen",
        description: "Ticketabläufe mit Regeln und Aktionen vereinfachen.",
        icon: Workflow,
      },
      {
        href: "/admin/scheduling",
        label: "Terminplanung",
        description: "Verfügbarkeiten, Buchungen und Kalender verwalten.",
        icon: CalendarDays,
      },
      {
        href: "/admin/support-analytics",
        label: "Support-Auswertung",
        description: "Auslastung, Reaktionszeiten und SLA im Blick behalten.",
        icon: Activity,
      },
    ],
  },
  {
    label: "KI & Wissen",
    description:
      "Assistenten konfigurieren, Wissen verbessern und Antworten prüfen.",
    tone: "violet",
    items: [
      {
        href: "/admin/configuration",
        label: "Assistent & Widget",
        description: "Assistent, Modellprofile und Kunden-Widget gestalten.",
        icon: SlidersHorizontal,
      },
      {
        href: "/admin/agents",
        label: "Agent-Versionen",
        description:
          "Konfigurationen veröffentlichen und im Playground testen.",
        icon: Bot,
      },
      {
        href: "/admin/settings/ai-models",
        label: "Modelle & Routing",
        description: "Modelle, Fallbacks und Routingregeln festlegen.",
        icon: GitBranch,
      },
      {
        href: "/admin/knowledge",
        label: "Wissensqualität",
        description: "Wissensquellen und ihre Qualität prüfen.",
        icon: BookOpen,
      },
      {
        href: "/admin/answer-quality",
        label: "Antwortqualität",
        description: "Antwortentwürfe vor der Verwendung überprüfen.",
        icon: Sparkles,
      },
      {
        href: "/admin/actions",
        label: "KI-Aktionen",
        description: "Aktionen und Freigaben für Assistenten steuern.",
        icon: Zap,
      },
      {
        href: "/admin/analytics",
        label: "Analytics & Wissenslücken",
        description: "Supportqualität auswerten und fehlendes Wissen erfassen.",
        icon: BarChart3,
      },
    ],
  },
  {
    label: "Organisation",
    description:
      "Zugänge, Ressourcen und verbundene Dienste zentral verwalten.",
    tone: "mint",
    items: [
      {
        href: "/admin/settings/organization",
        label: "Organisation",
        description: "Supportkontakt, Sprachen und Erscheinungsbild pflegen.",
        icon: Building2,
      },
      {
        href: "/admin/settings/roles",
        label: "Rollen & Rechte",
        description: "Berechtigungen für Admins, Agents und Viewer festlegen.",
        icon: UsersRound,
      },
      {
        href: "/admin/settings/quotas",
        label: "Kontingente",
        description: "Tokenbudgets und Anfragelimits verwalten.",
        icon: Gauge,
      },
      {
        href: "/admin/settings/api-keys",
        label: "Provider-Schlüssel",
        description: "Verschlüsselte Zugangsdaten hinterlegen und testen.",
        icon: KeyRound,
      },
      {
        href: "/admin/integrations",
        label: "Integrationen",
        description: "Externe Dienste verbinden und Verbindungen prüfen.",
        icon: Plug,
      },
      {
        href: "/admin/integrations/zendesk-inbound",
        label: "Zendesk Inbound",
        description: "Eingehende Zendesk-Ereignisse konfigurieren.",
        icon: Mail,
      },
      {
        href: "/admin/settings/github",
        label: "GitHub",
        description: "Die GitHub-Anbindung einrichten und testen.",
        icon: GitBranch,
      },
      {
        href: "/admin/notifications",
        label: "Benachrichtigungen",
        description: "Ereignisse und Benachrichtigungskanäle steuern.",
        icon: Bell,
      },
    ],
  },
  {
    label: "Plattform & Sicherheit",
    description:
      "Sicherheitseinstellungen, E-Mail-Versand und Änderungen prüfen.",
    tone: "slate",
    items: [
      {
        href: "/admin/platform-security",
        label: "Plattform-Sicherheit",
        description: "Zwei-Faktor-Authentifizierung plattformweit steuern.",
        icon: ShieldCheck,
      },
      {
        href: "/admin/settings/security",
        label: "Organisationssicherheit",
        description:
          "Sitzungen, Schlüsselrotation und Administratorzugriffe regeln.",
        icon: Shield,
      },
      {
        href: "/admin/mail-server",
        label: "Mailserver",
        description: "Den zentralen E-Mail-Versand einrichten und testen.",
        icon: Mail,
      },
      {
        href: "/admin/settings/audit-log",
        label: "Änderungsprotokoll",
        description: "Administrative Änderungen nachvollziehen.",
        icon: FileClock,
      },
    ],
  },
];

export function findAdminDestination(pathname: string) {
  return adminGroups
    .flatMap((group) => group.items)
    .filter(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
}
