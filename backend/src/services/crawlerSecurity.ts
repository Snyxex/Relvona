import dns from "dns/promises";
import net from "net";
import http from "http";
import https from "https";

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

      // Unspecified, CGNAT, documentation, multicast, and reserved ranges.
      if (parts[0] === 0 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 || parts[0] === 192 && parts[1] === 0 || parts[0] === 192 && parts[1] === 2 || parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51) || parts[0] === 203 && parts[1] === 0 && parts[2] === 113 || parts[0] >= 224) return true;
    }

    // IPv6 Check
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      if (lower === "::1" || lower === "::" || lower.startsWith("fe80:") || lower.startsWith("fc00:") || lower.startsWith("fd00:") || lower.startsWith("::ffff:127.") || lower.startsWith("::ffff:10.") || lower.startsWith("::ffff:192.168.") || lower.startsWith("::ffff:169.254.")) {
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

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    // 2. Reject explicit hostname keywords
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      throw new Error("Access to local/internal hostnames is prohibited (SSRF Protection).");
    }

    // 3. Perform DNS pre-resolution to prevent DNS rebinding & private IP access
    try {
      const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await dns.lookup(hostname, { all: true, verbatim: true });
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
    const { safeUrl, resolvedIp } = await this.validateAndResolveUrl(targetUrl);
    const parsed = new URL(safeUrl);
    const transport = parsed.protocol === "https:" ? https : http;
    const maxBytes = 5 * 1024 * 1024;
    return new Promise<string>((resolve, reject) => {
      const request = transport.request({ protocol: parsed.protocol, hostname: resolvedIp, port: parsed.port || undefined, path: `${parsed.pathname}${parsed.search}`, method: "GET", servername: parsed.hostname, headers: { Host: parsed.host, "User-Agent": "SupportAIBot/2.0", Accept: "text/html,application/xhtml+xml,text/plain" }, timeout: 10_000 }, (response) => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          const location = response.headers.location;
          if (!location) return reject(new Error("HTTP redirect response missing Location header."));
          return this.safeFetch(new URL(location, safeUrl).toString(), maxRedirects, currentDepth + 1).then(resolve, reject);
        }
        if (status < 200 || status >= 300) { response.resume(); return reject(new Error(`Crawl HTTP request failed with status: ${status}`)); }
        const type = response.headers["content-type"] || "";
        if (!/^(text\/html|text\/plain|application\/xhtml\+xml)(;|$)/i.test(type)) { response.resume(); return reject(new Error("Crawl response is not HTML or plain text.")); }
        if (Number(response.headers["content-length"] || 0) > maxBytes) { response.resume(); return reject(new Error("Page size exceeds 5MB maximum limit.")); }
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) request.destroy(new Error("Downloaded response body exceeds 5MB limit.")); else chunks.push(chunk); });
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      request.on("timeout", () => request.destroy(new Error("Crawl request timed out.")));
      request.on("error", reject);
      request.end();
    });
  }
}
