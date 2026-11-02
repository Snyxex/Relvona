"use client";

import dynamic from "next/dynamic";

const loading = () => (
  <div className="mx-auto max-w-7xl space-y-4" aria-live="polite" aria-busy="true">
    <div className="space-y-2">
      <div className="h-3 w-24 animate-pulse rounded-full bg-slate-800" />
      <div className="h-7 w-64 max-w-full animate-pulse rounded-lg bg-slate-800" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-800/70" />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />)}
    </div>
    <div className="h-52 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
    <span className="sr-only">Bereich wird geladen…</span>
  </div>
);

const overviewLoading = () => (
  <div className="rv-overview" aria-live="polite" aria-busy="true">
    <div className="rv-toolbar">
      <span className="h-9 w-60 max-w-full animate-pulse rounded-lg bg-slate-100" />
    </div>
    <div className="rv-overview-body">
      <div className="space-y-2">
        <div className="h-7 w-72 max-w-full animate-pulse rounded-lg bg-slate-200" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="rv-kpi-grid">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="rv-metric-card h-32 animate-pulse" />
        ))}
      </div>
      <div className="rv-chart-grid">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rv-panel h-64 animate-pulse" />
        ))}
      </div>
      <span className="sr-only">Relvona Dashboard wird geladen…</span>
    </div>
  </div>
);

export const LazyOverviewTab = dynamic(() => import("./overview-tab"), {
  loading: overviewLoading,
});
export const LazyAnalyticsTab = dynamic(() => import("./analytics-tab"), { loading });
export const LazyAgentsTab = dynamic(() => import("./agents-tab"), { loading });
export const LazyCustomersTab = dynamic(() => import("./customers-tab"), { loading });
