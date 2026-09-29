import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { alignLoopbackHost } from "./runtime-url";

const apiUrl = alignLoopbackHost(
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1",
);
const baseURL = alignLoopbackHost(
  process.env.NEXT_PUBLIC_AUTH_URL || apiUrl.replace(/\/api\/v1\/?$/, ""),
);

// Better Auth stores its session in an HttpOnly cookie.  Application code must
// use this client instead of reading or persisting authentication material.
export const authClient = createAuthClient({ baseURL, plugins: [twoFactorClient()] });
