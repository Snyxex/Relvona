/**
 * Automatic ticket assignment requires a recent positive availability signal.
 * An absent or stale presence row must not be treated as an available employee.
 */
export function isAvailableForAutomaticRouting(
  status: string | null | undefined,
  updatedAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!updatedAt || !Number.isFinite(updatedAt.getTime())) return false;
  const age = now.getTime() - updatedAt.getTime();
  if (age < 0 || age > 5 * 60_000) return false;
  return status === "ONLINE" || status === "AVAILABLE";
}
