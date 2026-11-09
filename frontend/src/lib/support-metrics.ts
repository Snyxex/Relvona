/** Safe display percentages for organization support analytics. */
export function ticketWorkload(statuses: { status: string; total: number }[]) {
  const workload = { open: 0, inProgress: 0, pending: 0, total: 0 };
  for (const { status, total } of statuses) {
    if (status === "open") workload.open += total;
    else if (status === "in_progress") workload.inProgress += total;
    else if (status === "pending") workload.pending += total;
  }
  workload.total = workload.open + workload.inProgress + workload.pending;
  return workload;
}

export function aiResolutionPercent(
  resolvedByAi: number | null | undefined,
  conversations: number | null | undefined,
): number | null {
  if (
    conversations === null ||
    conversations === undefined ||
    !Number.isFinite(conversations) ||
    conversations <= 0
  ) {
    return null;
  }
  if (
    resolvedByAi === null ||
    resolvedByAi === undefined ||
    !Number.isFinite(resolvedByAi) ||
    resolvedByAi < 0
  ) {
    return null;
  }
  return Math.min(
    100,
    Math.max(0, Math.round((resolvedByAi / conversations) * 100)),
  );
}

export function distributionPercent(value: number, total: number): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(total) ||
    value <= 0 ||
    total <= 0
  ) {
    return 0;
  }
  return Math.min(100, Math.max(0, (value / total) * 100));
}
