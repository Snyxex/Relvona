"use client";

import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("@/components/dashboard"), {
  ssr: false,
  loading: () => (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(79,140,255,0.14),transparent_34rem)]" />
      <div className="relative w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-2xl">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-blue-950/40">
          AI
        </div>
        <h1 className="mt-4 text-base font-semibold tracking-tight">SupportAI wird vorbereitet</h1>
        <p className="mt-1 text-sm text-muted-foreground">Arbeitsbereich und Organisationsdaten werden geladen.</p>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-2/5 animate-pulse rounded-full bg-primary" />
        </div>
      </div>
    </div>
  ),
});

export default function DashboardLoader({ administration = false }: { administration?: boolean }) {
  return <Dashboard administration={administration} />;
}
