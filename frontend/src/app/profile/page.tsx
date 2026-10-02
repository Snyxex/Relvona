import DashboardLoader from "@/components/dashboard-loader";
import { requirePageSession } from "@/lib/server-page-guard";

export default async function ProfilePage() {
  await requirePageSession("/profile");
  return <DashboardLoader initialTab="profile" />;
}
