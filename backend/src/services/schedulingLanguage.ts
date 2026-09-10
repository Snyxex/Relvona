export type SchedulingLanguage = "de" | "en";

const englishSignals = /\b(the|a|an|please|could|would|can|i|we|you|my|our|your|tomorrow|today|meeting|appointment|schedule|book|booking|cancel|available|availability|time|slot|confirm|confirmation|approved|pending)\b/i;
const germanSignals = /\b(der|die|das|ein|eine|bitte|kann|können|koennen|ich|wir|du|sie|mein|unser|ihr|morgen|heute|termin|besprechung|gespräch|gespraech|buchen|buchung|abbrechen|stornieren|frei|verfügbar|verfuegbar|uhr|freigabe|bestätigung|bestaetigung|ausstehend)\b/i;

export function detectSchedulingLanguage(text?: string | null): SchedulingLanguage {
  const value = String(text || "").trim();
  if (!value) return "de";
  const en = value.match(englishSignals)?.length || 0;
  const de = value.match(germanSignals)?.length || 0;
  return en > de ? "en" : "de";
}

export function schedulingText(language: SchedulingLanguage) {
  if (language === "en") {
    return {
      cancelled: "Appointment scheduling has been cancelled.",
      approvalPending: "The selected appointment is still waiting for approval. Once the action has been executed, the final appointment will be confirmed.",
      selectionRequired: "Please choose one of the offered appointments by number or time, or tell me a different time range.",
      noMeetingTypes: "There are currently no bookable appointment types configured for this organization.",
      noSlots: "I could not find an available appointment in the requested time range. You can give me a different time range.",
      selected: (slot: string) => `I selected ${slot}. The appointment is now waiting for the required approval.`,
      offered: (name: string, options: string) => `These times are available for “${name}”:\n${options}\n\nWhich time works for you?`,
      confirmed: (slot: string, meetingUrl?: string | null) => `The appointment is confirmed: ${slot}.${meetingUrl ? `\nMeeting link: ${meetingUrl}` : ""}`,
    };
  }
  return {
    cancelled: "Die Terminplanung wurde abgebrochen.",
    approvalPending: "Der ausgewählte Termin wartet noch auf Freigabe. Sobald die Aktion ausgeführt wurde, steht der endgültige Termin fest.",
    selectionRequired: "Bitte wählen Sie einen der angebotenen Termine per Nummer oder Uhrzeit aus, oder nennen Sie einen anderen Zeitraum.",
    noMeetingTypes: "Für diese Organisation sind aktuell keine buchbaren Terminarten eingerichtet.",
    noSlots: "Ich konnte im gewünschten Zeitraum keinen freien Termin finden. Sie können mir einen anderen Zeitraum nennen.",
    selected: (slot: string) => `Ich habe ${slot} ausgewählt. Der Termin wartet jetzt auf die erforderliche Freigabe.`,
    offered: (name: string, options: string) => `Für „${name}“ sind diese Zeiten frei:\n${options}\n\nWelche Zeit passt Ihnen?`,
    confirmed: (slot: string, meetingUrl?: string | null) => `Der Termin ist bestätigt: ${slot}.${meetingUrl ? `\nMeeting-Link: ${meetingUrl}` : ""}`,
  };
}

export function formatSchedulingSlot(date: Date, timezone: string, language: SchedulingLanguage, includeYear = false) {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "de-DE", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    ...(includeYear ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
