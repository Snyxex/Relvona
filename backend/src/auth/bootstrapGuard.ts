import { createHash, timingSafeEqual } from "node:crypto";

/** Fail-closed production bootstrap gate; token is never stored in the database. */
export function isBootstrapTokenAuthorized(
  supplied: unknown,
  configured: string | undefined = process.env.PLATFORM_BOOTSTRAP_TOKEN,
  production = process.env.NODE_ENV === "production",
): boolean {
  if (!configured && !production) return true; // development and disposable CI databases
  if (typeof configured !== "string" || configured.length < 32) return false;
  if (typeof supplied !== "string" || supplied.length < 32 || supplied.length > 512) return false;
  const expected = createHash("sha256").update(configured, "utf8").digest();
  const actual = createHash("sha256").update(supplied, "utf8").digest();
  return timingSafeEqual(expected, actual);
}
