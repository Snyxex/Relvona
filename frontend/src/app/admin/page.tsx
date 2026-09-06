import Link from "next/link";
const sections = [
 ["settings/ai-models", "KI-Modelle & Routing", "Primärmodell, Fallback, Antwortlänge und Routingregeln."],
 ["configuration", "Assistenten & Integrationen", "KI-Anbieter, Modellprofile, Widget und Mitarbeiter verwalten."],
 ["settings/api-keys", "Provider-Schlüssel", "Verschlüsselte Zugangsdaten hinterlegen und testen."],
 ["settings/quotas", "Kontingente", "Tokenbudget und Anfragen pro Minute begrenzen."],
 ["settings/organization", "Organisation", "Supportkontakt, Sprachen und Erscheinungsbild."],
 ["settings/security", "Sicherheit", "Sitzungen, Schlüsselrotation und Administrator-IP-Adressen."],
 ["settings/audit-log", "Änderungsprotokoll", "Administrative Änderungen nachvollziehen."],
];
export default function AdminPage() { return <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100"><div className="mx-auto max-w-6xl"><p className="text-sm text-blue-400">PLATTFORMADMINISTRATOR</p><h1 className="mt-3 text-3xl font-bold">Software verwalten</h1><p className="mt-3 text-slate-400">Zentrale Verwaltung aller Organisationen. Änderungen gelten für die oben ausgewählte Organisation.</p><div className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sections.map(([href,title,text]) => <Link key={href} href={"/admin/"+href} className="rounded-xl border border-slate-800 bg-slate-900 p-6 hover:border-blue-500"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></Link>)}</div></div></main>; }
