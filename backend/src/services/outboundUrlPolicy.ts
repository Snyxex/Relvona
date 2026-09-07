import dns from "node:dns/promises";
import net from "node:net";
import { CrawlerSecurity } from "./crawlerSecurity.js";

/**
 * Outbound policy for tenant-configurable local AI endpoints.
 * Hosted deployments deny private/internal destinations by default. A
 * self-hosted operator may opt in explicitly with LOCAL_AI_ALLOW_PRIVATE_NETWORKS=true.
 */
export class OutboundUrlPolicy {
  static privateLocalAiAllowed() {
    return process.env.LOCAL_AI_ALLOW_PRIVATE_NETWORKS === "true";
  }

  static normalizeLocalAiBaseUrl(value: unknown): string {
    if (typeof value !== "string") throw new Error("Local provider base URL must be a string");
    const trimmed = value.trim();
    if (!trimmed) return "";
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error("Local provider base URL must be an HTTP(S) URL without credentials or fragments");
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!this.privateLocalAiAllowed()) {
      if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        throw new Error("Private/internal local AI endpoints are disabled by deployment policy");
      }
      if (net.isIP(hostname) && CrawlerSecurity.isPrivateIP(hostname)) {
        throw new Error("Private/internal local AI endpoints are disabled by deployment policy");
      }
    }
    return url.toString().replace(/\/$/, "");
  }

  /** Re-resolve immediately before each request so stored DNS names cannot bypass save-time validation. */
  static async assertLocalAiUrlAllowed(targetUrl: string): Promise<void> {
    const url = new URL(targetUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Unsafe local AI endpoint");
    if (this.privateLocalAiAllowed()) return;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      throw new Error("Private/internal local AI endpoints are disabled by deployment policy");
    }
    const addresses = net.isIP(hostname)
      ? [{ address: hostname }]
      : await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => CrawlerSecurity.isPrivateIP(address))) {
      throw new Error("Private/internal local AI endpoints are disabled by deployment policy");
    }
  }
}
