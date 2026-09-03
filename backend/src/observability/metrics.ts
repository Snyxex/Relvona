import type { NextFunction, Request, Response } from "express";

type Labels = Record<string, string | number | boolean>;
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const durations = new Map<string, { count: number; sum: number }>();
const key = (name: string, labels: Labels = {}) => `${name}{${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${String(v).replace(/\\|"|\n/g, "_")}"`).join(",")}}`;

export const metrics = {
  increment(name: string, labels?: Labels, value = 1) { const metric = key(name, labels); counters.set(metric, (counters.get(metric) || 0) + value); },
  gauge(name: string, value: number, labels?: Labels) { gauges.set(key(name, labels), value); },
  observe(name: string, milliseconds: number, labels?: Labels) { const metric = key(name, labels); const current = durations.get(metric) || { count: 0, sum: 0 }; current.count++; current.sum += milliseconds / 1000; durations.set(metric, current); },
  render() {
    return [...counters, ...gauges].map(([metric, value]) => `${metric} ${value}`).concat(
      [...durations].flatMap(([metric, value]) => [`${metric}_count ${value.count}`, `${metric}_sum ${value.sum}`]),
    ).join("\n") + "\n";
  },
};

export function httpMetrics(req: Request, res: Response, next: NextFunction) {
  const startedAt = performance.now();
  res.on("finish", () => {
    const labels = { method: req.method, route: req.route?.path || req.path, status: res.statusCode };
    metrics.increment("supportai_http_requests_total", labels);
    metrics.observe("supportai_http_request_duration_seconds", performance.now() - startedAt, labels);
  });
  next();
}
