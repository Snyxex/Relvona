import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function requirePageSession(
  callbackPath: string,
  options: { requirePlatformAdmin?: boolean } = {},
) {
  const requestHeaders = await headers();
  const authenticated =
    requestHeaders.get("x-relvona-page-session") === "authenticated";
  const isPlatformAdmin =
    requestHeaders.get("x-relvona-platform-admin") === "true";

  if (!authenticated) {
    redirect(`/?next=${encodeURIComponent(callbackPath)}`);
  }
  if (options.requirePlatformAdmin && !isPlatformAdmin) {
    redirect("/");
  }
}
