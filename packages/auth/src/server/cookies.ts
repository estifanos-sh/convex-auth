import { readConfigSync, envOptionalString } from "./env";
import { isLocalHost } from "./url";

/**
 * Cookie flags shared by all OAuth flow cookies.
 *
 * `httpOnly` keeps values out of JS, `secure` + `sameSite: "none"` +
 * `partitioned` allow the cookie to ride cross-site redirect chains (the OAuth
 * provider domain) while staying isolated per top-level site (CHIPS).
 *
 * @internal
 */
export const SHARED_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "none",
  secure: true,
  path: "/",
  partitioned: true,
} as const;

/**
 * Encode a redirectTo URL into the OAuth state parameter.
 *
 * Folding `redirectTo` into the signed state lets it survive redirect chains
 * even when cookies are blocked (e.g. mobile webviews).
 */
export function encodeOAuthState(state: string, redirectTo: string | null): string {
  const json = JSON.stringify({ s: state, r: redirectTo });
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode an OAuth state parameter, extracting the original state and redirectTo.
 *
 * Returns `null` for malformed or unencoded state.
 */
export function decodeOAuthState(
  encoded: string,
): { state: string; redirectTo: string | null } | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const value: unknown = JSON.parse(atob(padded));
    if (
      typeof value === "object" &&
      value !== null &&
      "s" in value &&
      typeof value.s === "string"
    ) {
      return {
        state: value.s,
        redirectTo: "r" in value && typeof value.r === "string" ? value.r : null,
      };
    }
  } catch {}
  return null;
}

const REDIRECT_MAX_AGE = 60 * 15;
/** @internal */
export function redirectToParamCookie(providerId: string, redirectTo: string) {
  return {
    name: redirectToParamCookieName(providerId),
    value: redirectTo,
    options: { ...SHARED_COOKIE_OPTIONS, maxAge: REDIRECT_MAX_AGE },
  };
}

/** @internal */
export function useRedirectToParam(
  providerId: string,
  cookies: Record<string, string | undefined>,
) {
  const cookieName = redirectToParamCookieName(providerId);
  const redirectTo = cookies[cookieName];
  if (redirectTo === undefined) {
    return null;
  }

  const updatedCookie = {
    name: cookieName,
    value: "",
    options: { ...SHARED_COOKIE_OPTIONS, maxAge: 0 },
  };

  return { redirectTo, updatedCookie };
}

function redirectToParamCookieName(providerId: string) {
  const convexSiteUrl = readConfigSync(envOptionalString("CONVEX_SITE_URL"));
  return (!isLocalHost(convexSiteUrl ?? undefined) ? "__Host-" : "") + providerId + "RedirectTo";
}
