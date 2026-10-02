import assert from "node:assert/strict";
import {
  authorizePageRequest,
  hasPageSessionCookie,
  pageSessionApiUrl,
  validatePageSession,
} from "../src/lib/server-page-auth.ts";

assert.equal(hasPageSessionCookie(null), false);
assert.equal(hasPageSessionCookie("unrelated=value"), false);
assert.equal(hasPageSessionCookie("supportai.session_token="), false);
assert.equal(hasPageSessionCookie("supportai.session_token=junk"), true);
assert.equal(
  hasPageSessionCookie("__Secure-supportai.session_token=valid"),
  true,
);
assert.equal(
  pageSessionApiUrl("http://backend:8080/api/v1/"),
  "http://backend:8080/api/v1/auth/me",
);

let calls = 0;
const noCookie = await validatePageSession(null, {
  fetcher: async () => {
    calls += 1;
    return new Response();
  },
});
assert.equal(noCookie, null);
assert.equal(
  calls,
  0,
  "missing cookies must be rejected without a backend request",
);

const rejected = await validatePageSession("supportai.session_token=junk", {
  apiUrl: "http://backend:8080/api/v1",
  fetcher: async (_url, init) => {
    calls += 1;
    assert.equal(
      new Headers(init?.headers).get("cookie"),
      "supportai.session_token=junk",
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "manual");
    return Response.json({ error: "Authentication required" }, { status: 401 });
  },
});
assert.equal(rejected, null, "a forged cookie must not create a page session");

const malformed = await validatePageSession("supportai.session_token=value", {
  fetcher: async () => Response.json({ user: { isPlatformAdmin: true } }),
});
assert.equal(
  malformed,
  null,
  "a successful but malformed response must fail closed",
);

const valid = await validatePageSession(
  "__Secure-supportai.session_token=valid",
  {
    fetcher: async () =>
      Response.json({ user: { id: "user-1", isPlatformAdmin: true } }),
  },
);
assert.deepEqual(valid, { id: "user-1", isPlatformAdmin: true });

const unavailable = await validatePageSession("supportai.session_token=value", {
  fetcher: async () => {
    throw new Error("backend unavailable");
  },
});
assert.equal(unavailable, null, "backend failures must fail closed");

const sessionFetcher = async (_url, init) => {
  const cookie = new Headers(init?.headers).get("cookie") || "";
  if (cookie.includes("valid-admin")) {
    return Response.json({ user: { id: "admin-1", isPlatformAdmin: true } });
  }
  if (cookie.includes("valid-user")) {
    return Response.json({ user: { id: "user-1", isPlatformAdmin: false } });
  }
  return Response.json({ error: "Authentication required" }, { status: 401 });
};

assert.deepEqual(
  await authorizePageRequest("/admin/users", "supportai.session_token=junk", {
    fetcher: sessionFetcher,
  }),
  { allowed: false, redirectTo: "/?next=%2Fadmin" },
);
assert.deepEqual(
  await authorizePageRequest("/admin", "supportai.session_token=valid-user", {
    fetcher: sessionFetcher,
  }),
  { allowed: false, redirectTo: "/" },
);
assert.deepEqual(
  await authorizePageRequest(
    "/admin",
    "__Secure-supportai.session_token=valid-admin",
    { fetcher: sessionFetcher },
  ),
  { allowed: true, isPlatformAdmin: true },
);
assert.deepEqual(
  await authorizePageRequest("/profile", "supportai.session_token=valid-user", {
    fetcher: sessionFetcher,
  }),
  { allowed: true, isPlatformAdmin: false },
);

console.log("Server page authentication: 17 cases passed.");
