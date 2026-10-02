export type PageSessionUser = {
  id: string;
  isPlatformAdmin: boolean;
};

type SessionResponse = {
  user?: {
    id?: unknown;
    isPlatformAdmin?: unknown;
  };
};

type ValidatePageSessionOptions = {
  apiUrl?: string;
  fetcher?: typeof fetch;
};

export type PageAuthorizationDecision =
  | { allowed: true; isPlatformAdmin: boolean }
  | { allowed: false; redirectTo: string };

const SESSION_COOKIE_PATTERN =
  /(?:^|;\s*)(?:__Secure-)?supportai\.session_token=([^;]+)/;

export function hasPageSessionCookie(cookieHeader: string | null | undefined) {
  const value = SESSION_COOKIE_PATTERN.exec(cookieHeader || "")?.[1];
  return typeof value === "string" && value.trim().length > 0;
}

export function pageSessionApiUrl(configuredUrl?: string) {
  const baseUrl =
    configuredUrl ||
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8080/api/v1";
  return `${baseUrl.replace(/\/$/, "")}/auth/me`;
}

export async function validatePageSession(
  cookieHeader: string | null | undefined,
  options: ValidatePageSessionOptions = {},
): Promise<PageSessionUser | null> {
  if (!hasPageSessionCookie(cookieHeader)) return null;
  const forwardedCookie = cookieHeader || "";

  try {
    const response = await (options.fetcher || fetch)(
      pageSessionApiUrl(options.apiUrl),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          cookie: forwardedCookie,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as SessionResponse;
    if (typeof payload.user?.id !== "string" || !payload.user.id) return null;
    return {
      id: payload.user.id,
      isPlatformAdmin: payload.user.isPlatformAdmin === true,
    };
  } catch {
    return null;
  }
}

export async function authorizePageRequest(
  pathname: string,
  cookieHeader: string | null | undefined,
  options: ValidatePageSessionOptions = {},
): Promise<PageAuthorizationDecision> {
  const isProfile = pathname.startsWith("/profile");
  const callbackPath = isProfile ? "/profile" : "/admin";
  const user = await validatePageSession(cookieHeader, options);

  if (!user) {
    return {
      allowed: false,
      redirectTo: `/?next=${encodeURIComponent(callbackPath)}`,
    };
  }
  if (!isProfile && !user.isPlatformAdmin) {
    return { allowed: false, redirectTo: "/" };
  }
  return { allowed: true, isPlatformAdmin: user.isPlatformAdmin };
}
