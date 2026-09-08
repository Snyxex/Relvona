import dns from "node:dns/promises";
import net from "node:net";
import { CrawlerSecurity } from "./crawlerSecurity.js";

export function isValidWebhookUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

export async function assertWebhookUrlAllowed(value: string): Promise<void> {
  if (!isValidWebhookUrl(value)) throw new Error("Webhook URL must be a valid HTTPS URL");
  if (process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === "true") return;

  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Private/internal webhook endpoints are disabled by deployment policy");
  }

  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => CrawlerSecurity.isPrivateIP(address))) {
    throw new Error("Private/internal webhook endpoints are disabled by deployment policy");
  }
}
