import type { LucideIcon } from "lucide-react";
import {
  BarChart3, BookOpen, Bot, Globe, MessageSquare, Settings,
  Sliders, Sparkles, Ticket, UserCheck, Users,
} from "lucide-react";

export type DashboardTab =
  | "overview"
  | "conversations"
  | "tickets"
  | "knowledge"
  | "websites"
  | "assistant"
  | "agents"
  | "customers"
  | "analytics"
  | "widget"
  | "settings"
  | "profile";

type NavigationItem = {
  id: DashboardTab;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const NAVIGATION: readonly NavigationItem[] = [
  { id: "overview", label: "Dashboard", icon: BarChart3 },
  { id: "conversations", label: "Unterhaltungen", icon: MessageSquare },
  { id: "tickets", label: "Tickets", icon: Ticket },
  { id: "knowledge", label: "Wissensdatenbank", icon: BookOpen },
  { id: "websites", label: "Web-Crawler", icon: Globe },
  { id: "assistant", label: "AI-Assistent", icon: Bot, adminOnly: true },
  { id: "agents", label: "Support-Team", icon: Users, adminOnly: true },
  { id: "customers", label: "Kunden", icon: UserCheck },
  { id: "analytics", label: "Analytics", icon: Sparkles },
  { id: "widget", label: "Widget-Designer", icon: Sliders, adminOnly: true },
  { id: "settings", label: "Organisation", icon: Settings, adminOnly: true },
  { id: "profile", label: "Profil-Einstellungen", icon: UserCheck },
];

export function dashboardNavigation(administration: boolean): readonly NavigationItem[] {
  return NAVIGATION.filter((item) => administration ? item.adminOnly || item.id === "profile" : !item.adminOnly);
}
