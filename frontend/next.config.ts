import type { NextConfig } from "next";

const apiOrigins = (() => {
  try {
    const configured = new URL(
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1",
    );
    const origins = new Set([configured.origin]);

    if (["localhost", "127.0.0.1"].includes(configured.hostname)) {
      for (const hostname of ["localhost", "127.0.0.1"]) {
        const loopback = new URL(configured.origin);
        loopback.hostname = hostname;
        origins.add(loopback.origin);
      }
    }

    return [...origins];
  } catch {
    return ["http://localhost:8080", "http://127.0.0.1:8080"];
  }
})();

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigins.join(" ")} ws: wss:`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    resolveAlias: {
      "socket.io-client": "./src/lib/lazy-socket-client.ts",
      "socket.io-client-real":
        "./node_modules/socket.io-client/build/esm/index.js",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
