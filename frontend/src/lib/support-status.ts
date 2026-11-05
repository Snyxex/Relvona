/** Shared, presentation-only ticket labels. Backend state is the source of truth. */
export const TICKET_STATUS_OPTIONS = [
  { value: "open", label: "Offen" },
  { value: "in_progress", label: "In Bearbeitung" },
  { value: "pending", label: "Wartend" },
  { value: "resolved", label: "Gelöst" },
  { value: "closed", label: "Geschlossen" },
] as const;

export function ticketStatusLabel(status: string): string {
  return (
    TICKET_STATUS_OPTIONS.find((entry) => entry.value === status)?.label ??
    status
  );
}

export function ticketStatusTone(status: string): string {
  return TICKET_STATUS_OPTIONS.some((entry) => entry.value === status)
    ? status
    : "unknown";
}
