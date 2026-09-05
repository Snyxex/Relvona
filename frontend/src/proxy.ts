import { type NextRequest, NextResponse } from "next/server";

// This is only an optimistic UX redirect. Express performs the authoritative JWT,
// tenant-membership, and role check for every admin API request.
export function proxy(request: NextRequest) {
  const token = request.cookies.get("support_auth_token")?.value;
  if (!token) return NextResponse.redirect(new URL("/?next=/admin/settings/ai-models", request.url));
  return NextResponse.next();
}
export const config = { matcher: "/admin/:path*" };
