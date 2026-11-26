import https from "node:https";
import dns from "node:dns/promises";
import { CrawlerSecurity } from "../services/crawlerSecurity.js";
/** HTTPS only, bounded response, no redirects, DNS pinned per request. Private hosts require an explicit deployment allowlist. */
export async function oidcRequest(
  target: string,
  body?: URLSearchParams,
): Promise<any> {
  const u = new URL(target);
  if (u.protocol !== "https:" || u.username || u.password || u.hash)
    throw Error("SSO_ENDPOINT_INVALID");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  const trusted = (process.env.OIDC_ALLOWED_PRIVATE_HOSTS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .includes(host.toLowerCase());
  if (
    !addresses.length ||
    (!trusted && addresses.some((a) => CrawlerSecurity.isPrivateIP(a.address)))
  )
    throw Error("SSO_ENDPOINT_BLOCKED");
  return new Promise((resolve, reject) => {
    const request = https.request(
      u,
      {
        method: body ? "POST" : "GET",
        signal: AbortSignal.timeout(8000),
        lookup: (_hostname, options, callback) => {
          if (options.all) (callback as Function)(null, [addresses[0]]);
          else callback(null, addresses[0].address, addresses[0].family);
        },
        headers: body
          ? { "content-type": "application/x-www-form-urlencoded" }
          : { accept: "application/json" },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > 1024 * 1024) {
            res.destroy();
            reject(Error("SSO_RESPONSE_TOO_LARGE"));
          }
        });
        res.on("error", reject);
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300)
            return reject(Error("SSO_PROVIDER_REQUEST_FAILED"));
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(Error("SSO_PROVIDER_RESPONSE_INVALID"));
          }
        });
      },
    );
    request.setTimeout(8000, () =>
      request.destroy(Error("SSO_PROVIDER_TIMEOUT")),
    );
    request.on("error", reject);
    request.end(body?.toString());
  });
}
export async function discoverOidc(issuer: string) {
  const data = await oidcRequest(
    issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
  );
  if (
    data.issuer !== issuer ||
    !data.response_types_supported?.includes("code") ||
    !data.code_challenge_methods_supported?.includes("S256")
  )
    throw Error("SSO_DISCOVERY_INVALID");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    const u = new URL(data[key]);
    if (
      u.protocol !== "https:" ||
      u.origin !== new URL(issuer).origin ||
      u.username ||
      u.password ||
      u.hash
    )
      throw Error("SSO_DISCOVERY_ENDPOINT_INVALID");
  }
  return data as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
  };
}
