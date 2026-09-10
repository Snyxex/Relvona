"use client";

import dynamic from "next/dynamic";

const loading = () => (
  <div className="mx-auto max-w-7xl rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
    Bereich wird geladen…
  </div>
);

export const LazyOverviewTab = dynamic(
  () => import("./overview-tab"),
  { loading },
);
export const LazyAnalyticsTab = dynamic(
  () => import("./analytics-tab"),
  { loading },
);
export const LazyAgentsTab = dynamic(
  () => import("./agents-tab"),
  { loading },
);
export const LazyCustomersTab = dynamic(
  () => import("./customers-tab"),
  { loading },
);
