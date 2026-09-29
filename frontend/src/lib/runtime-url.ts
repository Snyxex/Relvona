const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Keep local browser requests and auth cookies on the same loopback host. */
export function alignLoopbackHost(configuredUrl: string) {
  if (typeof window === "undefined") return configuredUrl;

  try {
    const url = new URL(configuredUrl);
    if (
      LOOPBACK_HOSTS.has(url.hostname) &&
      LOOPBACK_HOSTS.has(window.location.hostname)
    ) {
      url.hostname = window.location.hostname;
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Leave relative or otherwise non-standard deployment URLs unchanged.
  }

  return configuredUrl;
}
