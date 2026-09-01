import dns from "dns/promises";
import net from "net";

export class CrawlerSecurity {
  // Check if an IP address falls into private/loopback/metadata ranges
  static isPrivateIP(ip: string): boolean {
    if (!net.isIP(ip)) return true;

    // IPv4 Check
    if (net.isIPv4(ip)) {
      const parts = ip.split(".").map(Number);

      // Loopback (127.0.0.0/8) & Zero (0.0.0.0)
      if (parts[0] === 127 || (parts[0] === 0 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0)) {
        return true;
      }
      // 10.0.0.0/8
      if (parts[0] === 10) return true;

      // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

      // 192.168.0.0/16
      if (parts[0] === 192 && parts[1] === 168) return true;

      // Link-local & Cloud Metadata (169.254.0.0/16 including 169.254.169.254)
      if (parts[0] === 169 && parts[1] === 254) return true;

      // Broadcast
      if (parts[0] === 255 && parts[1] === 255 && parts[2] === 255 && parts[3] === 255) return true;
    }

    // IPv6 Check
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      if (lower === "::1" || lower === "::" || lower.startsWith("fe80:") || lower.startsWith("fc00:") || lower.startsWith("fd00:")) {
        return true;
      }
    }

    return false;
  }

  // Pre-validate Target URL and resolve DNS before initiating connection
  static async validateAndResolveUrl(targetUrl: string): Promise<{ safeUrl: string; resolvedIp: string }> {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      throw new Error("Malformed target URL");
    }

    // 1. Strict Protocol Whitelist
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Prohibited protocol '${parsed.protocol}'. Only HTTP and HTTPS are permitted.`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // 2. Reject explicit hostname keywords
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      throw new Error("Access to local/internal hostnames is prohibited (SSRF Protection).");
    }

    // 3. Perform DNS pre-resolution to prevent DNS rebinding & private IP access
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        throw new Error(`DNS resolution failed for hostname '${hostname}'`);
      }

      for (const addr of addresses) {
        if (this.isPrivateIP(addr.address)) {
          throw new Error(`Target resolved to prohibited private/internal IP address (${addr.address}). Request blocked.`);
        }
      }

      return { safeUrl: parsed.toString(), resolvedIp: addresses[0].address };
    } catch (err) {
      throw new Error(`SSRF Validation Failed: ${(err as Error).message}`);
    }
  }

  // Safe HTTP Fetch for Web Crawling with Timeout, Size Cap, and Redirect Revalidation
  static async safeFetch(targetUrl: string, maxRedirects = 3, currentDepth = 0): Promise<string> {
    if (currentDepth > maxRedirects) {
      throw new Error("Crawl aborted: Maximum HTTP redirect limit exceeded.");
    }

    // 1. Pre-validate URL & resolve IP
    const { safeUrl } = await this.validateAndResolveUrl(targetUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout cap

    try {
      const response = await fetch(safeUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SupportAIBot/2.0; +https://platform.com/bot)",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
        signal: controller.signal,
        redirect: "manual", // Handle redirects manually to validate each target IP
      });

      clearTimeout(timeoutId);

      // Handle Redirects securely
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const redirectLocation = response.headers.get("location");
        if (!redirectLocation) {
          throw new Error("HTTP redirect response missing Location header.");
        }
        const resolvedRedirect = new URL(redirectLocation, safeUrl).toString();
        return await this.safeFetch(resolvedRedirect, maxRedirects, currentDepth + 1);
      }

      if (!response.ok) {
        throw new Error(`Crawl HTTP request failed with status: ${response.status}`);
      }

      // Check Content-Length header cap (max 5MB)
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
        throw new Error("Page size exceeds 5MB maximum limit.");
      }

      const bodyText = await response.text();
      if (bodyText.length > 5 * 1024 * 1024) {
        throw new Error("Downloaded response body exceeds 5MB limit.");
      }

      return bodyText;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}
