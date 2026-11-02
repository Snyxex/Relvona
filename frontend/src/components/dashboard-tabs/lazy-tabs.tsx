"use client";

import dynamic from "next/dynamic";

const loading = () => (
  <div className="rv-section-page rv-modern-skeleton" role="status" aria-live="polite" aria-busy="true">
    <div className="space-y-3">
      <div className="h-3 w-24 animate-pulse rounded bg-blue-100" />
      <div className="h-8 w-64 max-w-full animate-pulse rounded-lg bg-slate-200" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
    </div>
    <div className="rv-section-kpis">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="rv-section-metric h-32 animate-pulse" />
      ))}
    </div>
    <div className="rv-section-grid rv-section-grid-two">
      {[0, 1].map((item) => (
        <div key={item} className="rv-section-panel h-56 animate-pulse" />
      ))}
    </div>
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
