export type DashboardLanguage = "de" | "en" | "es" | "fr";

type Translation = Record<DashboardLanguage, string>;

const translations: Record<string, Translation> = {
  "Overview": { de: "Übersicht", en: "Overview", es: "Resumen", fr: "Aperçu" },
  "Conversations Inbox": { de: "Unterhaltungen", en: "Conversations Inbox", es: "Bandeja de conversaciones", fr: "Boîte de conversations" },
  "Support Tickets": { de: "Support-Tickets", en: "Support Tickets", es: "Tickets de soporte", fr: "Tickets d’assistance" },
  "Knowledge Bases": { de: "Wissensdatenbanken", en: "Knowledge Bases", es: "Bases de conocimiento", fr: "Bases de connaissances" },
  "Web Crawler": { de: "Web-Crawler", en: "Web Crawler", es: "Rastreador web", fr: "Robot web" },
  "AI Assistant Settings": { de: "KI-Assistent", en: "AI Assistant Settings", es: "Asistente de IA", fr: "Assistant IA" },
  "Support Agents": { de: "Support-Agenten", en: "Support Agents", es: "Agentes de soporte", fr: "Agents d’assistance" },
  "Customer Directory": { de: "Kundenverzeichnis", en: "Customer Directory", es: "Directorio de clientes", fr: "Répertoire clients" },
  "Analytics & Insights": { de: "Analysen", en: "Analytics & Insights", es: "Análisis", fr: "Analyses" },
  "Embeddable Widget": { de: "Einbettbares Chat-Widget", en: "Embeddable Widget", es: "Widget integrable", fr: "Widget intégrable" },
  "Organization Settings": { de: "Organisationseinstellungen", en: "Organization Settings", es: "Configuración de la organización", fr: "Paramètres de l’organisation" },
  "My Profile": { de: "Mein Profil", en: "My Profile", es: "Mi perfil", fr: "Mon profil" },
  "Sign Out": { de: "Abmelden", en: "Sign Out", es: "Cerrar sesión", fr: "Se déconnecter" },
  "Save profile": { de: "Profil speichern", en: "Save profile", es: "Guardar perfil", fr: "Enregistrer le profil" },
  "Profile image": { de: "Profilbild", en: "Profile image", es: "Imagen de perfil", fr: "Image de profil" },
  "Remove image": { de: "Bild entfernen", en: "Remove image", es: "Eliminar imagen", fr: "Supprimer l’image" },
  "Name": { de: "Name", en: "Name", es: "Nombre", fr: "Nom" },
  "Preferred language": { de: "Bevorzugte Sprache", en: "Preferred language", es: "Idioma preferido", fr: "Langue préférée" },
  "Manage your name, profile image, and preferred dashboard language.": { de: "Verwalte deinen Namen, dein Profilbild und deine bevorzugte Dashboard-Sprache.", en: "Manage your name, profile image, and preferred dashboard language.", es: "Gestiona tu nombre, imagen de perfil e idioma preferido.", fr: "Gérez votre nom, votre image de profil et votre langue préférée." },
  "Platform Dashboard Overview": { de: "Dashboard-Übersicht", en: "Platform Dashboard Overview", es: "Resumen del panel", fr: "Aperçu du tableau de bord" },
  "Multi-tenant AI support agent performance and live status": { de: "Leistung und Live-Status des mandantenfähigen KI-Supports", en: "Multi-tenant AI support agent performance and live status", es: "Rendimiento y estado en directo del soporte de IA multiempresa", fr: "Performances et état en direct du support IA multi-tenant" },
  "Total Conversations": { de: "Unterhaltungen gesamt", en: "Total Conversations", es: "Conversaciones totales", fr: "Conversations totales" },
  "AI Resolution Rate": { de: "KI-Lösungsrate", en: "AI Resolution Rate", es: "Tasa de resolución de IA", fr: "Taux de résolution IA" },
  "Human Handoffs": { de: "Übergaben an Menschen", en: "Human Handoffs", es: "Transferencias a agentes", fr: "Transferts à des agents" },
  "Open Support Tickets": { de: "Offene Support-Tickets", en: "Open Support Tickets", es: "Tickets abiertos", fr: "Tickets ouverts" },
  "Knowledge Base Coverage": { de: "Abdeckung der Wissensdatenbank", en: "Knowledge Base Coverage", es: "Cobertura de la base de conocimiento", fr: "Couverture de la base de connaissances" },
  "Recent Unanswered Queries": { de: "Kürzlich unbeantwortete Fragen", en: "Recent Unanswered Queries", es: "Consultas recientes sin respuesta", fr: "Demandes récentes sans réponse" },
  "Conversation states": { de: "Gesprächsstatus", en: "Conversation states", es: "Estados de conversación", fr: "États des conversations" },
  "Detected languages": { de: "Erkannte Sprachen", en: "Detected languages", es: "Idiomas detectados", fr: "Langues détectées" },
  "Questions needing attention": { de: "Fragen mit Handlungsbedarf", en: "Questions needing attention", es: "Preguntas que requieren atención", fr: "Questions nécessitant une attention" },
  "Active Conversations": { de: "Aktive Unterhaltungen", en: "Active Conversations", es: "Conversaciones activas", fr: "Conversations actives" },
  "Customer Support Tickets": { de: "Kunden-Support-Tickets", en: "Customer Support Tickets", es: "Tickets de atención al cliente", fr: "Tickets de support client" },
  "Interne Kommentare": { de: "Ticket-Kommunikation", en: "Ticket communication", es: "Comunicación del ticket", fr: "Communication du ticket" },
  "Noch keine Kommentare.": { de: "Noch keine Ticket-Kommunikation.", en: "No ticket communication yet.", es: "Todavía no hay comunicación en el ticket.", fr: "Aucune communication sur le ticket pour le moment." },
  "Interne Notiz hinzufügen…": { de: "Interne Notiz hinzufügen…", en: "Add internal note…", es: "Añadir nota interna…", fr: "Ajouter une note interne…" },
  "Wähle ein Ticket, um Anfrage, Status und interne Kommentare zu sehen.": { de: "Wähle ein Ticket, um Anfrage, Status und die gesamte Ticket-Kommunikation zu sehen.", en: "Select a ticket to view the request, status, and full ticket communication.", es: "Selecciona un ticket para ver la solicitud, el estado y toda la comunicación.", fr: "Sélectionnez un ticket pour voir la demande, le statut et toute la communication." },
  "Knowledge Base & PDF Processing": { de: "Wissensdatenbank und PDF-Verarbeitung", en: "Knowledge Base & PDF Processing", es: "Base de conocimiento y procesamiento de PDF", fr: "Base de connaissances et traitement PDF" },
  "Recursive Website Crawler": { de: "Rekursiver Website-Crawler", en: "Recursive Website Crawler", es: "Rastreador web recursivo", fr: "Robot de site web récursif" },
  "AI Assistant Configuration": { de: "KI-Assistent konfigurieren", en: "AI Assistant Configuration", es: "Configuración del asistente IA", fr: "Configuration de l’assistant IA" },
  "Embeddable Customer Chat Widget": { de: "Einbettbares Kunden-Chat-Widget", en: "Embeddable Customer Chat Widget", es: "Widget de chat para clientes", fr: "Widget de chat client intégrable" },
  "Manage tenant identity and API keys": { de: "Verwalte Mandantenidentität und API-Schlüssel", en: "Manage tenant identity and API keys", es: "Gestiona la identidad de la organización y las claves API", fr: "Gérez l’identité du tenant et les clés API" },
  "Customer": { de: "Kunde", en: "Customer", es: "Cliente", fr: "Client" },
  "Email": { de: "E-Mail", en: "Email", es: "Correo electrónico", fr: "E-mail" },
  "Role": { de: "Rolle", en: "Role", es: "Rol", fr: "Rôle" },
  "Status": { de: "Status", en: "Status", es: "Estado", fr: "Statut" },
  "Created": { de: "Erstellt", en: "Created", es: "Creado", fr: "Créé" },
  "Priority": { de: "Priorität", en: "Priority", es: "Prioridad", fr: "Priorité" },
  "Subject": { de: "Betreff", en: "Subject", es: "Asunto", fr: "Objet" },
  "Title": { de: "Titel", en: "Title", es: "Título", fr: "Titre" },
  "Content": { de: "Inhalt", en: "Content", es: "Contenido", fr: "Contenu" },
  "PDF File": { de: "PDF-Datei", en: "PDF File", es: "Archivo PDF", fr: "Fichier PDF" },
  "Save Widget Access Settings": { de: "Widget-Zugriff speichern", en: "Save Widget Access Settings", es: "Guardar acceso al widget", fr: "Enregistrer l’accès au widget" },
};

const sourceByText = new Map<string, string>();
for (const [source, values] of Object.entries(translations)) {
  sourceByText.set(source, source);
  for (const translated of Object.values(values)) sourceByText.set(translated, source);
}

function translate(value: string, language: DashboardLanguage) {
  const key = sourceByText.get(value.trim());
  return key ? translations[key][language] : value;
}

function styleTicketCommunication() {
  document.querySelectorAll<HTMLElement>("p").forEach((authorLine) => {
    const label = authorLine.textContent?.trim() || "";
    const card = authorLine.parentElement;
    if (!card) return;

    let palette: { border: string; background: string; badgeBackground: string; badgeColor: string } | null = null;
    let type = "";
    if (label.startsWith("Interne Notiz ·")) {
      type = "internal-note";
      palette = { border: "rgba(245, 158, 11, 0.55)", background: "rgba(120, 53, 15, 0.22)", badgeBackground: "rgba(180, 83, 9, 0.35)", badgeColor: "rgb(253, 230, 138)" };
    } else if (label.startsWith("Öffentliche Antwort ·")) {
      type = "public-reply";
      palette = { border: "rgba(59, 130, 246, 0.55)", background: "rgba(30, 64, 175, 0.18)", badgeBackground: "rgba(37, 99, 235, 0.3)", badgeColor: "rgb(191, 219, 254)" };
    } else if (label.startsWith("Zendesk-Kunde ·") || label.startsWith("Externer Kunde ·")) {
      type = "external-customer";
      palette = { border: "rgba(16, 185, 129, 0.55)", background: "rgba(6, 78, 59, 0.2)", badgeBackground: "rgba(5, 150, 105, 0.28)", badgeColor: "rgb(167, 243, 208)" };
    }
    if (!palette || card.dataset.ticketCommunicationType === type) return;

    card.dataset.ticketCommunicationType = type;
    card.style.border = `1px solid ${palette.border}`;
    card.style.backgroundColor = palette.background;
    card.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.18)";
    authorLine.style.display = "inline-flex";
    authorLine.style.alignItems = "center";
    authorLine.style.width = "fit-content";
    authorLine.style.padding = "2px 7px";
    authorLine.style.borderRadius = "9999px";
    authorLine.style.backgroundColor = palette.badgeBackground;
    authorLine.style.color = palette.badgeColor;
    authorLine.style.fontWeight = "600";
    authorLine.style.letterSpacing = "0.01em";
  });
}

function localizeNow(language: DashboardLanguage) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent || ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) continue;
    const original = node.nodeValue || "";
    const translated = translate(original, language);
    if (translated !== original) node.nodeValue = original.replace(original.trim(), translated);
  }
  document.querySelectorAll<HTMLElement>("[title],[aria-label],[placeholder]").forEach((element) => {
    for (const attribute of ["title", "aria-label", "placeholder"] as const) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const translated = translate(value, language);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  });
  styleTicketCommunication();
  if (document.documentElement.lang !== language) document.documentElement.lang = language;
}

let pendingLanguage: DashboardLanguage = "de";
let scheduledFrame: number | null = null;

/** Coalesces MutationObserver bursts into at most one full dashboard localization pass per frame. */
export function localizeDashboard(language: DashboardLanguage) {
  pendingLanguage = language;
  if (scheduledFrame !== null) return;
  scheduledFrame = window.requestAnimationFrame(() => {
    scheduledFrame = null;
    localizeNow(pendingLanguage);
  });
}
