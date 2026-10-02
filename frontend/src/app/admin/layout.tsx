import type { ReactNode } from "react";
import AdminLayoutClient from "./admin-layout-client";
import { requirePageSession } from "@/lib/server-page-guard";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requirePageSession("/admin", { requirePlatformAdmin: true });
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
