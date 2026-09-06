import { createAuthClient } from "better-auth/react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";
const baseURL = process.env.NEXT_PUBLIC_AUTH_URL || apiUrl.replace(/\/api\/v1\/?$/, "");

// Better Auth stores its session in an HttpOnly cookie.  Application code must
// use this client instead of reading or persisting authentication material.
export const authClient = createAuthClient({ baseURL });
