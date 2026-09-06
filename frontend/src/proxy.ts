import { type NextRequest, NextResponse } from "next/server";

// This is only an optimistic UX redirect. Express performs the authoritative
// Better Auth session, tenant-membership, and role check for every API request.
export function proxy(request: NextRequest) {
  const session = request.cookies.get("supportai.session_token")?.value;
  if (!session) return NextResponse.redirect(new URL("/?next=/admin", request.url));
  return NextResponse.next();
}
export const config = { matcher: "/admin/:path*" };
