import { type NextRequest, NextResponse } from "next/server";
import { authorizePageRequest } from "./lib/server-page-auth";

const VERIFIED_SESSION_HEADER = "x-relvona-page-session";
const VERIFIED_PLATFORM_ADMIN_HEADER = "x-relvona-platform-admin";

function redirectWithoutCache(target: URL) {
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// Page responses are gated before rendering so invalid cookies cannot disclose
// HTML or RSC shells. Express remains authoritative for every data-bearing API.
export async function proxy(request: NextRequest) {
  const decision = await authorizePageRequest(
    request.nextUrl.pathname,
    request.headers.get("cookie"),
  );

  if (!decision.allowed) {
    return redirectWithoutCache(new URL(decision.redirectTo, request.url));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(VERIFIED_SESSION_HEADER, "authenticated");
  requestHeaders.set(
    VERIFIED_PLATFORM_ADMIN_HEADER,
    decision.isPlatformAdmin ? "true" : "false",
  );
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/admin/:path*", "/profile"] };
