"use client";

import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("@/components/dashboard"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
      Dashboard wird geladen…
    </div>
  ),
});

export default function DashboardLoader({ administration = false }: { administration?: boolean }) {
  return <Dashboard administration={administration} />;
}
