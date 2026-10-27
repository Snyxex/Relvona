export function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export type SupportForecast = {
  model: "linear_14_day_run_rate";
  sampleDays: 14;
  horizonDays: 7;
  arrivalsLast14Days: number;
  resolutionsLast14Days: number;
  averageDailyArrivals: number;
  averageDailyResolutions: number;
  currentBacklog: number;
  estimatedBacklogAfter7Days: number;
  availableAgents: number;
  risk: "insufficient_data" | "no_coverage" | "high" | "moderate" | "low";
  disclaimer: string;
};

export function estimateSupportDemand(input: {
  arrivals14: number; resolved14: number; backlog: number; availableAgents: number;
}): SupportForecast {
  const arrivalsLast14Days = Math.max(0, input.arrivals14);
  const resolutionsLast14Days = Math.max(0, input.resolved14);
  const currentBacklog = Math.max(0, input.backlog);
  const availableAgents = Math.max(0, input.availableAgents);
  const arrivalsPerDay = arrivalsLast14Days / 14;
  const completionsPerDay = resolutionsLast14Days / 14;
  const estimatedBacklogAfter7Days = Math.max(0, Math.round(currentBacklog + 7 * (arrivalsPerDay - completionsPerDay)));
  let risk: SupportForecast["risk"] = "low";
  if (availableAgents === 0 && (currentBacklog > 0 || arrivalsLast14Days > 0)) risk = "no_coverage";
  else if (arrivalsLast14Days + resolutionsLast14Days < 7) risk = "insufficient_data";
  else if (estimatedBacklogAfter7Days >= currentBacklog + 5 && estimatedBacklogAfter7Days > availableAgents * 8) risk = "high";
  else if (estimatedBacklogAfter7Days > availableAgents * 8 || estimatedBacklogAfter7Days >= currentBacklog + 3) risk = "moderate";
  return {
    model: "linear_14_day_run_rate", sampleDays: 14, horizonDays: 7,
    arrivalsLast14Days, resolutionsLast14Days,
    averageDailyArrivals: Math.round(arrivalsPerDay * 100) / 100,
    averageDailyResolutions: Math.round(completionsPerDay * 100) / 100,
    currentBacklog, estimatedBacklogAfter7Days, availableAgents, risk,
    disclaimer: "Indikative 7-Tage-Hochrechnung aus den vergangenen 14 Tagen, ohne Saisonalität, Schichtwechsel, Ticketkomplexität oder zugesicherte Personalplanung.",
  };
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function completeDailySeries(
  days: number,
  now: Date,
  arrivals: Array<{ day: string; total: number }>,
  resolutions: Array<{ day: string; total: number }>,
): Array<{ day: string; arrivals: number; resolutions: number }> {
  const dailyArrivals = new Map(arrivals.map(r => [r.day, Number(r.total)]));
  const dailyResolutions = new Map(resolutions.map(r => [r.day, Number(r.total)]));
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) => {
    const day = utcDay(new Date(midnight - (days - i - 1) * 86_400_000));
    return { day, arrivals: dailyArrivals.get(day) || 0, resolutions: dailyResolutions.get(day) || 0 };
  });
}
