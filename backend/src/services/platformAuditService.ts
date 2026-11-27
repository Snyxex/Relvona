import { hostname, userInfo } from "node:os";

/**
 * Use the actual local process account and host to identify the operator
 * execution context. Preserve restricted shell and command execution logs to
 * associate a service account with an individual human operator.
 */
export function localOperatorAuditIdentity(): string {
  const username = userInfo().username.trim();
  const host = hostname().trim();
  if (!username || !host) throw new Error("OPERATOR_AUDIT_IDENTITY_UNAVAILABLE");
  return ("unix:" + username + "@" + host).slice(0, 300);
}
