import { notFound } from "next/navigation";
import SettingsClient from "../settings-client";

const sections = ["quotas", "ai-models", "api-keys", "github", "organization", "security", "audit-log"] as const;

export default async function SettingsPage({ params }: PageProps<"/admin/settings/[section]">) {
  const { section } = await params;
  if (!(sections as readonly string[]).includes(section)) notFound();
  return <SettingsClient initialSection={section as (typeof sections)[number]} />;
}
