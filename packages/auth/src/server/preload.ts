import { ConvexHttpClient } from "convex/browser";
import {
  getFunctionName,
  makeFunctionReference,
  type FunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import { convexToJson, ConvexError, type Value } from "convex/values";
import { parse, serialize } from "cookie";
import { jwtDecode } from "jwt-decode";

import type { Preloaded } from "convex/react";

import type { AuthTokens } from "../shared/results";
import { log } from "./log";
import type { SignInParams } from "./payloads";
import type { SignInAction, SignInActionResult, SignOutAction } from "./runtime";
import { isLocalHost } from "./url";

const signInActionRef: SignInAction = makeFunctionReference("auth:signIn");
const signOutActionRef: SignOutAction = makeFunctionReference("auth:signOut");

/** Cookie lifetime configuration for auth tokens. */
export type AuthCookieConfig = {
  /** Maximum age in seconds, or `null` for session cookies. */
  maxAge: number | null;
};

/** Raw cookie values extracted from a request. */
export type AuthCookies = {
  /** The JWT access token, or `null` when absent. */
  token: string | null;
  /** The refresh token, or `null` when absent. */
  refreshToken: string | null;
  /** The OAuth PKCE verifier, or `null` when absent. */
  verifier: string | null;
};

/** A structured cookie ready to be set via any framework's cookie API. */
export type AuthCookie = {
  name: string;
  value: string;
  options: {
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
    maxAge?: number;
    expires?: Date;
  };
};

type ProxyActionBody = {
  action?: unknown;
  args?: unknown;
};

type ProxySignInArgs = {
  verifier?: string;
  continuation?: string;
  calledBy?: string;
  request: {
    params?: SignInParams;
    refreshToken?: string | true;
  };
};

/**
 * Options for the SSR auth helper returned by {@link server}.
 */
export type ServerOptions = {
  /** Convex deployment API URL (e.g. `https://your-app.convex.cloud`). */
  url: string;
  /**
   * Accepted JWT issuers for `refresh()` and `verify()`.
   *
   * By default, this is derived from `url`. If `url` ends with
   * `.convex.cloud`, the matching `.convex.site` issuer is also accepted.
   */
  acceptedIssuers?: string[];
  /**
   * Path the client POSTs auth actions to. Defaults to `"/api/auth"`.
   * Must match the `proxyPath` option on the client.
   *
   * @defaultValue "/api/auth"
   */
  apiRoute?: string;
  /** Cookie `maxAge` in seconds, or `null` for session cookies. */
  cookieMaxAge?: number | null;
  /** Enable verbose debug logging for token refresh and cookie operations. */
  verbose?: boolean;
  /**
   * Optional namespace for auth cookie names.
   *
   * Use this to isolate auth cookies between multiple local apps on the same host.
   * If omitted, a deterministic deployment-scoped namespace is derived from `url`.
   */
  cookieNamespace?: string;
  /**
   * Control whether `refresh()` handles OAuth `?code=` query parameters.
   *
   * - `true` (default): always exchange the code on GET requests with `text/html` accept.
   * - `false`: never exchange — useful when only the client handles codes.
   * - A function: called with the `Request` for per-request decisions.
   *
   * @defaultValue true
   */
  shouldHandleCode?: ((request: Request) => boolean | Promise<boolean>) | boolean;
};

/**
 * Result returned from `server().preload()`.
 *
 * Covers both normal SSR token refreshes and OAuth code-exchange redirects.
 */
export type PreloadResult =
  | {
      /** Code exchange occurred — return the pre-built redirect `Response`. */
      redirect: true;
      /** 302 redirect with Set-Cookie headers already serialized. */
      response: Response;
    }
  | {
      /** No redirect — apply cookies and read the token. */
      redirect: false;
      /** Structured cookies to set on the response. */
      cookies: AuthCookie[];
      /** JWT for SSR hydration, or `null` if not authenticated. */
      token: string | null;
      /**
       * Pre-authenticated `ConvexHttpClient` wired with the refreshed token,
       * ready for one-shot SSR queries. `null` when not authenticated.
       */
      convex: ConvexHttpClient | null;
      /**
       * Run a query against Convex with the refreshed token and return a
       * `Preloaded<Query>` payload that pairs with `usePreloadedQuery` from
       * `convex/react` for flash-free SSR hydration.
       *
       * Returns `null` for the value when not authenticated; the
       * `Preloaded` payload is still typed against the query.
       */
      preloadQuery: <Query extends FunctionReference<"query">>(
        query: Query,
        ...args: PreloadQueryArgs<Query>
      ) => Promise<Preloaded<Query>>;
    };

type PreloadQueryArgs<Query extends FunctionReference<"query">> =
  FunctionArgs<Query> extends Record<string, never>
    ? [args?: FunctionArgs<Query>]
    : [args: FunctionArgs<Query>];

const TOKEN_COOKIE_BASE_NAME = "__convexAuthJWT";
const REFRESH_COOKIE_BASE_NAME = "__convexAuthRefreshToken";
const VERIFIER_COOKIE_BASE_NAME = "__convexAuthOAuthVerifier";
const DERIVED_COOKIE_NAMESPACE_FALLBACK = "convexauth";

/**
 * Derive the cookie names used for auth tokens.
 *
 * On localhost the names are unprefixed; on production hosts they
 * use the `__Host-` prefix for tighter security.
 *
 * @param host - The `Host` header value. Omit to use unprefixed names.
 * @param cookieNamespace - Optional namespace suffix for cookie isolation.
 * @returns An object with `token`, `refreshToken`, and `verifier` cookie names.
 */
export function authCookieNames(host?: string, cookieNamespace?: string | null) {
  const prefix = isLocalHost(host) ? "" : "__Host-";
  const namespace = normalizeCookieNamespace(cookieNamespace);
  const suffix = namespace === null ? "" : `_${namespace}`;
  return {
    token: `${prefix}${TOKEN_COOKIE_BASE_NAME}${suffix}`,
    refreshToken: `${prefix}${REFRESH_COOKIE_BASE_NAME}${suffix}`,
    verifier: `${prefix}${VERIFIER_COOKIE_BASE_NAME}${suffix}`,
  };
}

/**
 * Parse auth cookie values from a raw `Cookie` header string.
 *
 * @param cookieHeader - The raw `Cookie` header, or `null`/`undefined`.
 * @param host - The `Host` header, used to determine cookie name prefixes.
 * @param cookieNamespace - Optional namespace suffix for cookie isolation.
 * @returns Parsed {@link AuthCookies} with `token`, `refreshToken`, and `verifier`.
 */
export function parseAuthCookies(
  cookieHeader: string | null | undefined,
  host?: string,
  cookieNamespace?: string | null,
): AuthCookies {
  const names = authCookieNames(host, cookieNamespace);
  const parsed = parse(cookieHeader ?? "");
  return {
    token: parsed[names.token] ?? null,
    refreshToken: parsed[names.refreshToken] ?? null,
    verifier: parsed[names.verifier] ?? null,
  };
}

/**
 * Serialize auth cookies into `Set-Cookie` header strings.
 *
 * Nulled-out values produce deletion cookies (maxAge 0, expired date).
 *
 * @param cookies - The auth cookie values to serialize.
 * @param host - The `Host` header, used for cookie name prefixes and `Secure` flag.
 * @param config - Cookie lifetime config. Defaults to session cookies.
 * @param cookieNamespace - Optional namespace suffix for cookie isolation.
 * @returns An array of three `Set-Cookie` header strings.
 */
export function serializeAuthCookies(
  cookies: AuthCookies,
  host?: string,
  config: AuthCookieConfig = { maxAge: null },
  cookieNamespace?: string | null,
) {
  const names = authCookieNames(host, cookieNamespace);
  const secure = !isLocalHost(host);
  const base = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };
  const maxAge = config.maxAge ?? undefined;
  const serialized = [
    serialize(names.token, cookies.token ?? "", {
      ...base,
      maxAge: cookies.token === null ? 0 : maxAge,
      expires: cookies.token === null ? new Date(0) : undefined,
    }),
    serialize(names.refreshToken, cookies.refreshToken ?? "", {
      ...base,
      maxAge: cookies.refreshToken === null ? 0 : maxAge,
      expires: cookies.refreshToken === null ? new Date(0) : undefined,
    }),
    serialize(names.verifier, cookies.verifier ?? "", {
      ...base,
      maxAge: cookies.verifier === null ? 0 : maxAge,
      expires: cookies.verifier === null ? new Date(0) : undefined,
    }),
  ];
  return serialized;
}

/**
 * Build structured cookie objects for any SSR framework.
 *
 * Use with SvelteKit's `event.cookies.set()`, TanStack Start's `setCookie()`,
 * Next.js's `cookies().set()`, or any other framework cookie API.
 *
 * @param cookies - The auth cookie values to convert.
 * @param host - The `Host` header, used for cookie name prefixes and `Secure`.
 * @param config - Cookie lifetime config. Defaults to session cookies.
 * @param cookieNamespace - Optional namespace suffix for cookie isolation.
 * @returns Structured cookie descriptors ready for framework cookie APIs.
 */
export function structuredAuthCookies(
  cookies: AuthCookies,
  host?: string,
  config: AuthCookieConfig = { maxAge: null },
  cookieNamespace?: string | null,
): AuthCookie[] {
  const names = authCookieNames(host, cookieNamespace);
  const secure = !isLocalHost(host);
  const base = {
    path: "/" as const,
    httpOnly: true as const,
    secure,
    sameSite: "lax" as const,
  };
  const maxAge = config.maxAge ?? undefined;
  const structured: AuthCookie[] = [
    {
      name: names.token,
      value: cookies.token ?? "",
      options: {
        ...base,
        maxAge: cookies.token === null ? 0 : maxAge,
        expires: cookies.token === null ? new Date(0) : undefined,
      },
    },
    {
      name: names.refreshToken,
      value: cookies.refreshToken ?? "",
      options: {
        ...base,
        maxAge: cookies.refreshToken === null ? 0 : maxAge,
        expires: cookies.refreshToken === null ? new Date(0) : undefined,
      },
    },
    {
      name: names.verifier,
      value: cookies.verifier ?? "",
      options: {
        ...base,
        maxAge: cookies.verifier === null ? 0 : maxAge,
        expires: cookies.verifier === null ? new Date(0) : undefined,
      },
    },
  ];

  return structured;
}

/**
 * Check whether a request pathname matches the auth proxy route.
 *
 * Handles trailing-slash ambiguity: both `/api/auth` and `/api/auth/`
 * match regardless of how `apiRoute` is configured.
 *
 * @param pathname - The request URL pathname.
 * @param apiRoute - The configured proxy route (e.g. `"/api/auth"`).
 * @returns `true` when the pathname matches the proxy route.
 *
 * @see {@link server}
 */
export function shouldProxyAuthAction(pathname: string, apiRoute: string) {
  if (apiRoute.endsWith("/")) {
    return pathname === apiRoute || pathname === apiRoute.slice(0, -1);
  }
  return pathname === apiRoute || pathname === `${apiRoute}/`;
}

const REQUIRED_TOKEN_LIFETIME_MS = 30_000;
const MINIMUM_REQUIRED_TOKEN_LIFETIME_MS = 5_000;
const JSON_HEADERS = { "Content-Type": "application/json" };

type DecodedToken = { exp?: number; iat?: number; iss?: string };

function decodeToken(token: string): DecodedToken | null {
  try {
    return jwtDecode<DecodedToken>(token);
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function appendCookieHeaders(response: Response, values: string[]): Response {
  for (const value of values) {
    response.headers.append("Set-Cookie", value);
  }
  return response;
}

function isConvexValue(value: unknown): value is Value {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return true;
  }
  if (typeof value === "boolean" || typeof value === "bigint" || value instanceof ArrayBuffer) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isConvexValue);
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  return Object.values(value).every(isConvexValue);
}

function isConvexObject(value: unknown): value is Record<string, Value> {
  return (
    !Array.isArray(value) && value !== null && typeof value === "object" && isConvexValue(value)
  );
}

function getConvexErrorCode(error: unknown): string | null {
  if (!(error instanceof ConvexError) || !isConvexObject(error.data)) {
    return null;
  }
  return typeof error.data.code === "string" ? error.data.code : null;
}

function getProxyErrorBody(error: unknown) {
  if (error instanceof ConvexError && isConvexObject(error.data) && "code" in error.data) {
    return {
      error: typeof error.data.message === "string" ? error.data.message : String(error),
      authError: error.data,
    };
  }
  return {
    error: error instanceof Error ? error.message : String(error),
  };
}

function extractSignedInTokens(result: SignInActionResult, context: string): AuthTokens | null {
  if (result.kind === "signedIn") {
    return result.session;
  }
  throw new Error(`Invalid \`auth:signIn\` result for ${context}`);
}

function normalizeCookieNamespace(cookieNamespace?: string | null) {
  if (cookieNamespace === undefined || cookieNamespace === null) {
    return null;
  }
  const normalized = cookieNamespace
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Safely check if a string is a valid URL without throwing.
 */
function canParseUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function serializeAuthCookie(cookie: AuthCookie): string {
  const parts = [`${cookie.name}=${cookie.value}`, `Path=${cookie.options.path}`];
  if (cookie.options.httpOnly) parts.push("HttpOnly");
  if (cookie.options.secure) parts.push("Secure");
  if (cookie.options.sameSite) parts.push(`SameSite=${cookie.options.sameSite}`);
  if (cookie.options.maxAge !== undefined) parts.push(`Max-Age=${cookie.options.maxAge}`);
  if (cookie.options.expires) parts.push(`Expires=${cookie.options.expires.toUTCString()}`);
  return parts.join("; ");
}

function buildRedirectResponse(location: string, cookies: AuthCookie[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", serializeAuthCookie(cookie));
  }
  return new Response(null, { status: 302, headers });
}

function deriveCookieNamespaceFromUrl(url: string) {
  if (!canParseUrl(url)) return DERIVED_COOKIE_NAMESPACE_FALLBACK;
  const parsed = new URL(url);
  const raw = `${parsed.hostname}${parsed.pathname}`;
  return normalizeCookieNamespace(raw) ?? DERIVED_COOKIE_NAMESPACE_FALLBACK;
}

function normalizeIssuer(value: string) {
  if (!canParseUrl(value)) return value.replace(/\/+$/, "");
  const parsed = new URL(value);
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

function convexSiteIssuerFromCloudUrl(value: string) {
  if (!canParseUrl(value)) return null;
  const parsed = new URL(value);
  if (!parsed.hostname.endsWith(".convex.cloud")) {
    return null;
  }
  parsed.hostname = parsed.hostname.slice(0, -".convex.cloud".length) + ".convex.site";
  return normalizeIssuer(parsed.toString());
}

function appendAuthIssuerPrefix(value: string) {
  const issuer = normalizeIssuer(value);
  return issuer.endsWith("/auth") ? issuer : `${issuer}/auth`;
}

function defaultAcceptedIssuersForUrl(value: string) {
  const issuers = [normalizeIssuer(value)];
  const siteIssuer = convexSiteIssuerFromCloudUrl(value);
  if (siteIssuer !== null) {
    issuers.push(siteIssuer);
    issuers.push(appendAuthIssuerPrefix(siteIssuer));
  }
  return issuers;
}

/**
 * Create an SSR auth helper for server-side frameworks.
 *
 * Handles cookie-based token management, OAuth code exchange,
 * and automatic JWT refresh on page loads. Works with any
 * framework that gives you a `Request` object — SvelteKit,
 * TanStack Start, Remix, Next.js, etc.
 *
 * @param options - SSR configuration (Convex API URL, issuer rules, proxy route, cookie lifetime).
 * @returns An object with `token`, `verify`, `proxy`, and `preload` methods.
 *
 * @example SvelteKit hooks
 * ```ts
 * // src/hooks.server.ts
 * import { server } from '@estifanos-sh/convex-auth/server';
 *
 * const auth = server({ url: CONVEX_URL });
 *
 * export const handle = async ({ event, resolve }) => {
 *   const result = await auth.preload(event.request);
 *   if (result.redirect) return result.response;
 *   for (const c of result.cookies) event.cookies.set(c.name, c.value, c.options);
 *   event.locals.token = result.token;
 *   return resolve(event);
 * };
 * ```
 *
 * @example Generic proxy endpoint
 * ```ts
 * if (shouldProxyAuthAction(url.pathname, '/api/auth')) {
 *   return auth.proxy(request);
 * }
 * ```
 *
 * @param options - Server-side auth configuration including Convex URL,
 *   accepted issuers, proxy route, and cookie behavior.
 * @returns SSR helpers for reading tokens, refreshing cookies, and proxying
 *   auth actions through an httpOnly-cookie layer.
 *
 * @see {@link shouldProxyAuthAction}
 */
export function server(options: ServerOptions) {
  const convexUrl = options.url;
  const apiRoute = options.apiRoute ?? "/api/auth";
  const cookieConfig = { maxAge: options.cookieMaxAge ?? null };
  const verbose = options.verbose ?? false;
  const cookieNamespace =
    normalizeCookieNamespace(options.cookieNamespace) ?? deriveCookieNamespaceFromUrl(convexUrl);
  const acceptedIssuers = new Set(
    (options.acceptedIssuers ?? defaultAcceptedIssuersForUrl(convexUrl))
      .map(normalizeIssuer)
      .filter((issuer) => issuer.length > 0),
  );

  return {
    /**
     * Read the JWT from the request cookies without any validation.
     *
     * @param request - The incoming HTTP request.
     * @returns The raw JWT string, or `null` when no token cookie exists.
     */
    token(request: Request): string | null {
      return parseAuthCookies(
        request.headers.get("cookie"),
        request.headers.get("host") ?? new URL(request.url).host,
        cookieNamespace,
      ).token;
    },

    /**
     * Check whether the request carries a non-expired JWT.
     *
     * Performs local expiration checking only (no network call).
     * Use for lightweight auth guards in middleware.
     *
     * @param request - The incoming HTTP request.
     * @returns `true` when a valid, non-expired JWT exists in the cookies.
     */
    async verify(request: Request): Promise<boolean> {
      const token = parseAuthCookies(
        request.headers.get("cookie"),
        request.headers.get("host") ?? new URL(request.url).host,
        cookieNamespace,
      ).token;
      if (token === null) {
        return false;
      }
      const decodedToken = decodeToken(token);
      return (
        decodedToken?.exp !== undefined &&
        decodedToken.iss !== undefined &&
        acceptedIssuers.has(normalizeIssuer(decodedToken.iss)) &&
        decodedToken.exp * 1000 > Date.now()
      );
    },

    /**
     * Handle a proxied `signIn` or `signOut` POST from the client.
     *
     * Validates the route, method, and origin, then forwards the
     * action to Convex and returns a `Response` with updated
     * `Set-Cookie` headers. The client never sees the real
     * refresh token — it stays in httpOnly cookies.
     *
     * @param request - The incoming POST request from the client.
     * @returns A JSON `Response` with auth result and cookie headers.
     */
    async proxy(request: Request): Promise<Response> {
      const createClient = (token?: string | null) => {
        const client = new ConvexHttpClient(convexUrl);
        if (token !== null && token !== undefined) {
          client.setAuth(token);
        }
        return client;
      };
      const runSignIn = async (client: ConvexHttpClient, args: ProxySignInArgs) =>
        client.action(signInActionRef, args) as Promise<SignInActionResult>;
      const runSignOut = async (token?: string | null) =>
        createClient(token).action(signOutActionRef);
      const hydrateProxySignInClient = async (
        currentCookies: AuthCookies,
        args: ProxySignInArgs,
      ): Promise<{ client: ConvexHttpClient; cookies: AuthCookies }> => {
        const client = createClient();
        const requestParams =
          typeof args.request.params === "object" && args.request.params !== null
            ? args.request.params
            : undefined;
        const shouldAttachCurrentIdentity =
          args.request.refreshToken === undefined && requestParams?.code === undefined;

        if (!shouldAttachCurrentIdentity) {
          return { client, cookies: currentCookies };
        }

        const currentToken = currentCookies.token;
        const decodedTokenValue = currentToken === null ? null : decodeToken(currentToken);
        const hasValidCurrentToken =
          currentToken !== null &&
          decodedTokenValue?.exp !== undefined &&
          decodedTokenValue.iss !== undefined &&
          acceptedIssuers.has(normalizeIssuer(decodedTokenValue.iss)) &&
          decodedTokenValue.exp * 1000 > Date.now();

        if (hasValidCurrentToken) {
          client.setAuth(currentToken);
          return { client, cookies: currentCookies };
        }

        if (currentCookies.refreshToken === null) {
          return { client, cookies: currentCookies };
        }

        let refreshedTokens: AuthTokens | null = null;
        try {
          const result = await runSignIn(createClient(), {
            request: { refreshToken: currentCookies.refreshToken },
          });
          refreshedTokens = extractSignedInTokens(result, "proxy sign-in auth hydration");
        } catch {
          refreshedTokens = null;
        }

        if (refreshedTokens === null) {
          return { client, cookies: currentCookies };
        }

        client.setAuth(refreshedTokens.token);

        return {
          client,
          cookies: {
            token: refreshedTokens.token,
            refreshToken: refreshedTokens.refreshToken,
            verifier: currentCookies.verifier,
          } satisfies AuthCookies,
        };
      };
      const toSignInProxyResponse = (
        result: SignInActionResult,
        args: ProxySignInArgs,
        currentCookies: AuthCookies,
        host: string,
      ): Response => {
        if (result.kind === "redirect") {
          return appendCookieHeaders(
            jsonResponse({
              kind: "redirect",
              redirect: result.redirect,
              verifier: result.verifier,
            }),
            serializeAuthCookies(
              {
                ...currentCookies,
                verifier: result.verifier,
              },
              host,
              cookieConfig,
              cookieNamespace,
            ),
          );
        }
        if (result.kind === "signedIn") {
          const nextCookies =
            result.session === null
              ? {
                  token: currentCookies.token,
                  refreshToken: currentCookies.refreshToken,
                  verifier: null,
                }
              : {
                  token: result.session.token,
                  refreshToken: result.session.refreshToken,
                  verifier: null,
                };
          return appendCookieHeaders(
            jsonResponse({
              kind: "signedIn",
              session:
                result.session === null
                  ? null
                  : {
                      token: result.session.token,
                      refreshToken: "dummy",
                    },
            }),
            serializeAuthCookies(nextCookies, host, cookieConfig, cookieNamespace),
          );
        }
        return jsonResponse(result);
      };

      const requestUrl = new URL(request.url);
      const requestDispatch = !shouldProxyAuthAction(requestUrl.pathname, apiRoute)
        ? { kind: "invalidRoute" as const }
        : request.method !== "POST"
          ? { kind: "invalidMethod" as const }
          : (() => {
                const originHeader = request.headers.get("origin");
                if (originHeader === null) {
                  return false;
                }
                const forwardedProtoHeader = request.headers.get("x-forwarded-proto");
                const protocol =
                  forwardedProtoHeader !== null
                    ? (() => {
                        const forwardedProto = forwardedProtoHeader.split(",")[0]?.trim();
                        if (forwardedProto !== undefined && forwardedProto.length > 0) {
                          return forwardedProto.endsWith(":")
                            ? forwardedProto
                            : `${forwardedProto}:`;
                        }
                        return new URL(request.url).protocol;
                      })()
                    : new URL(request.url).protocol;
                const requestHost = request.headers.get("host") ?? new URL(request.url).host;
                const hostCandidate = `${protocol}//${requestHost}`;
                const host = canParseUrl(hostCandidate) ? new URL(hostCandidate).host : requestHost;
                if (!canParseUrl(originHeader)) {
                  return true;
                }
                const originUrl = new URL(originHeader);
                return originUrl.host !== host || originUrl.protocol !== protocol;
              })()
            ? { kind: "invalidOrigin" as const }
            : { kind: "valid" as const };

      let validationErrorResponse: Response | null = null;
      if (requestDispatch.kind === "invalidRoute") {
        validationErrorResponse = new Response("Invalid route", { status: 404 });
      } else if (requestDispatch.kind === "invalidMethod") {
        validationErrorResponse = new Response("Invalid method", { status: 405 });
      } else if (requestDispatch.kind === "invalidOrigin") {
        validationErrorResponse = new Response("Invalid origin", { status: 403 });
      }
      if (validationErrorResponse !== null) {
        return validationErrorResponse;
      }

      let body: ProxyActionBody | null = null;
      try {
        const parsed = await request.json();
        body = isConvexObject(parsed) ? parsed : null;
      } catch {
        body = null;
      }
      if (body === null) {
        return new Response("Invalid request body", { status: 400 });
      }

      const action = body.action;
      const args: ProxySignInArgs = isConvexObject(body.args)
        ? {
            ...body.args,
            request: isConvexObject(body.args.request) ? { ...body.args.request } : {},
          }
        : { request: {} };
      if (args.request.refreshToken === null) {
        args.request.refreshToken = undefined;
      }
      const actionDispatch =
        action === "auth:signIn"
          ? { action: "signInStart" as const }
          : action === "auth:signOut"
            ? { action: "sessionStop" as const }
            : null;
      if (actionDispatch === null) {
        return new Response("Invalid action", { status: 400 });
      }

      const host = request.headers.get("host") ?? new URL(request.url).host;
      const currentCookies = parseAuthCookies(request.headers.get("cookie"), host, cookieNamespace);

      if (actionDispatch.action === "signInStart") {
        let refreshResponse: Response | null = null;
        if (args.request.refreshToken === undefined) {
          refreshResponse = null;
        } else if (currentCookies.refreshToken === null) {
          const currentToken = currentCookies.token;
          const decodedToken = currentToken === null ? null : decodeToken(currentToken);
          if (
            currentToken !== null &&
            decodedToken?.exp !== undefined &&
            decodedToken.iss !== undefined &&
            acceptedIssuers.has(normalizeIssuer(decodedToken.iss)) &&
            decodedToken.exp * 1000 > Date.now()
          ) {
            refreshResponse = jsonResponse({
              tokens: { token: currentToken, refreshToken: "dummy" },
            });
          } else {
            refreshResponse = jsonResponse({ tokens: null });
          }
        } else {
          args.request.refreshToken = currentCookies.refreshToken ?? undefined;
          refreshResponse = null;
        }
        if (refreshResponse !== null) {
          return refreshResponse;
        }

        const { client, cookies: effectiveCookies } = await hydrateProxySignInClient(
          currentCookies,
          args,
        );

        try {
          const result = await runSignIn(client, args);
          return toSignInProxyResponse(result, args, effectiveCookies, host);
        } catch (error) {
          return appendCookieHeaders(
            jsonResponse(getProxyErrorBody(error), 400),
            serializeAuthCookies(
              {
                token: effectiveCookies.token,
                refreshToken: effectiveCookies.refreshToken,
                verifier: null,
              },
              host,
              cookieConfig,
              cookieNamespace,
            ),
          );
        }
      } else {
        try {
          await runSignOut(currentCookies.token);
        } catch (error) {
          log("ERROR", "[convex-auth/server] proxy sign-out failed", error);
          if (currentCookies.refreshToken !== null) {
            try {
              const refreshed = await runSignIn(createClient(), {
                request: { refreshToken: currentCookies.refreshToken },
              });
              const refreshedTokens = extractSignedInTokens(refreshed, "sign-out fallback refresh");
              if (refreshedTokens !== null) {
                await runSignOut(refreshedTokens.token);
              }
            } catch (fallbackError) {
              log("ERROR", "[convex-auth/server] proxy sign-out fallback failed", fallbackError);
            }
          }
        }

        return appendCookieHeaders(
          jsonResponse(null),
          serializeAuthCookies(
            {
              token: null,
              refreshToken: null,
              verifier: null,
            },
            host,
            cookieConfig,
            cookieNamespace,
          ),
        );
      }
    },

    /**
     * Preload SSR auth state on every page load.
     *
     * Call in server hooks/middleware on every request. Handles three scenarios:
     *
     * 1. **OAuth code exchange** — exchanges a `?code=` query param for tokens and returns a redirect URL.
     * 2. **Token refresh** — refreshes the JWT if it's close to expiry.
     * 3. **No-op** — returns the existing token when no refresh is needed.
     *
     * The non-redirect result includes `preloadQuery(query, args)` for producing
     * `Preloaded<Query>` payloads that pair with `usePreloadedQuery` from
     * `convex/react`.
     *
     * @param request - The incoming HTTP request.
     * @returns Structured cookies to set on the response, an optional redirect URL, the current JWT, and a typed `preloadQuery` helper.
     */
    async preload(request: Request): Promise<PreloadResult> {
      const createClient = () => new ConvexHttpClient(convexUrl);
      const authenticatedClient = (token: string | null): ConvexHttpClient | null =>
        token ? new ConvexHttpClient(convexUrl, { auth: token }) : null;
      const buildPreloadQuery =
        (client: ConvexHttpClient | null) =>
        async <Query extends FunctionReference<"query">>(
          query: Query,
          ...args: PreloadQueryArgs<Query>
        ): Promise<Preloaded<Query>> => {
          const queryArgs = (args[0] ?? {}) as FunctionArgs<Query>;
          const value =
            client === null
              ? null
              : ((await client.query(query, queryArgs)) as FunctionReturnType<Query>);
          const payload = {
            _name: getFunctionName(query),
            _argsJSON: convexToJson(queryArgs as Value),
            _valueJSON: convexToJson((value ?? null) as Value),
          };
          return payload as Preloaded<Query>;
        };
      const logVerbose = (message: string) => {
        if (verbose) {
          log("DEBUG", `${new Date().toISOString()} [convex-auth/server] ${message}`);
        }
      };
      const refreshWithToken = async (
        refreshToken: string,
      ): Promise<AuthTokens | null | undefined> => {
        try {
          const result = (await createClient().action(signInActionRef, {
            request: { refreshToken },
          })) as SignInActionResult;
          const tokens = extractSignedInTokens(result, "token refresh");
          logVerbose(`Refreshed tokens, null=${tokens === null}`);
          return tokens;
        } catch (error) {
          log("ERROR", "[convex-auth/server] refresh-token exchange failed", error);
          if (getConvexErrorCode(error) === "INVALID_REFRESH_TOKEN") {
            logVerbose("Refresh token rejected, clearing auth cookies");
            return null;
          }
          logVerbose("Token refresh failed transiently, keeping current cookies");
          return undefined;
        }
      };

      const host = request.headers.get("host") ?? new URL(request.url).host;
      const currentCookies = parseAuthCookies(request.headers.get("cookie"), host, cookieNamespace);
      const currentToken = currentCookies.token;

      const originHeader = request.headers.get("origin");
      const forwardedProtoHeader = request.headers.get("x-forwarded-proto");
      const protocol =
        forwardedProtoHeader !== null
          ? (() => {
              const forwardedProto = forwardedProtoHeader.split(",")[0]?.trim();
              if (forwardedProto !== undefined && forwardedProto.length > 0) {
                return forwardedProto.endsWith(":") ? forwardedProto : `${forwardedProto}:`;
              }
              return new URL(request.url).protocol;
            })()
          : new URL(request.url).protocol;
      const requestHost = request.headers.get("host") ?? new URL(request.url).host;
      const hostCandidate = `${protocol}//${requestHost}`;
      const normalizedHost = canParseUrl(hostCandidate) ? new URL(hostCandidate).host : requestHost;
      const originUrl =
        originHeader !== null && canParseUrl(originHeader) ? new URL(originHeader) : null;
      const corsRequest =
        originHeader !== null &&
        (originUrl === null ||
          originUrl.host !== normalizedHost ||
          originUrl.protocol !== protocol);
      if (corsRequest) {
        return {
          redirect: false,
          cookies: [],
          token: null,
          convex: null,
          preloadQuery: buildPreloadQuery(null),
        } satisfies PreloadResult;
      }

      const requestUrl = new URL(request.url);
      const code = requestUrl.searchParams.get("code");
      const shouldHandleCodeOption = options.shouldHandleCode;
      let shouldHandleCode: boolean;
      if (shouldHandleCodeOption === undefined) {
        shouldHandleCode = true;
      } else if (typeof shouldHandleCodeOption === "function") {
        const result = shouldHandleCodeOption(request);
        shouldHandleCode = typeof result === "boolean" ? result : await result;
      } else {
        shouldHandleCode = shouldHandleCodeOption;
      }

      let codeExchangeResult: PreloadResult | null = null;
      if (
        code !== null &&
        request.method === "GET" &&
        request.headers.get("accept")?.includes("text/html") &&
        shouldHandleCode
      ) {
        const redirectUrl = new URL(requestUrl.toString());
        try {
          const result = (await createClient().action(signInActionRef, {
            request: { params: { code } },
            verifier: currentCookies.verifier ?? undefined,
          })) as SignInActionResult;
          const tokens = extractSignedInTokens(result, "code exchange");
          redirectUrl.searchParams.delete("code");
          const cookies = structuredAuthCookies(
            {
              token: tokens?.token ?? null,
              refreshToken: tokens?.refreshToken ?? null,
              verifier: null,
            },
            host,
            cookieConfig,
            cookieNamespace,
          );
          codeExchangeResult = {
            redirect: true,
            response: buildRedirectResponse(redirectUrl.toString(), cookies),
          } satisfies PreloadResult;
        } catch (error) {
          log("ERROR", "[convex-auth/server] code exchange failed", error);
          const terminalCodeExchangeError = [
            "OAUTH_INVALID_STATE",
            "OAUTH_PROVIDER_ERROR",
            "OAUTH_MISSING_ID_TOKEN",
            "OAUTH_INVALID_PROFILE",
            "OAUTH_MISSING_VERIFIER",
            "INVALID_VERIFIER",
            "INVALID_VERIFICATION_CODE",
          ].includes(getConvexErrorCode(error) ?? "");
          if (!terminalCodeExchangeError) {
            const client = authenticatedClient(currentCookies.token);
            codeExchangeResult = {
              redirect: false,
              cookies: [],
              token: currentCookies.token,
              convex: client,
              preloadQuery: buildPreloadQuery(client),
            } satisfies PreloadResult;
          } else {
            redirectUrl.searchParams.delete("code");
            const cookies = structuredAuthCookies(
              {
                token: currentCookies.token,
                refreshToken: currentCookies.refreshToken,
                verifier: null,
              },
              host,
              cookieConfig,
              cookieNamespace,
            );
            codeExchangeResult = {
              redirect: true,
              response: buildRedirectResponse(redirectUrl.toString(), cookies),
            } satisfies PreloadResult;
          }
        }
      }
      if (codeExchangeResult !== null) {
        return codeExchangeResult;
      }

      const { token, refreshToken } = currentCookies;
      const isMalformedRefreshToken =
        refreshToken !== null && (refreshToken.trim().length === 0 || refreshToken === "dummy");
      if (isMalformedRefreshToken) {
        logVerbose("Refresh token cookie malformed, clearing auth cookies");
        return {
          redirect: false,
          cookies: structuredAuthCookies(
            { token: null, refreshToken: null, verifier: null },
            host,
            cookieConfig,
            cookieNamespace,
          ),
          token: null,
          convex: null,
          preloadQuery: buildPreloadQuery(null),
        } satisfies PreloadResult;
      }

      const decodedToken = token === null ? null : decodeToken(token);
      if (
        decodedToken?.iss !== undefined &&
        !acceptedIssuers.has(normalizeIssuer(decodedToken.iss))
      ) {
        logVerbose("Access token issuer mismatch, clearing auth cookies");
        return {
          redirect: false,
          cookies: structuredAuthCookies(
            { token: null, refreshToken: null, verifier: null },
            host,
            cookieConfig,
            cookieNamespace,
          ),
          token: null,
          convex: null,
          preloadQuery: buildPreloadQuery(null),
        } satisfies PreloadResult;
      }

      let tokens: AuthTokens | null | undefined;
      if (token === null && refreshToken === null) {
        logVerbose("No auth cookies found, skipping refresh");
        tokens = undefined;
      } else if (token === null && refreshToken !== null) {
        logVerbose("Access token cookie missing, attempting refresh-token recovery");
        tokens = await refreshWithToken(refreshToken);
      } else if (token !== null && refreshToken === null) {
        if (
          decodedToken?.exp !== undefined &&
          decodedToken.iss !== undefined &&
          acceptedIssuers.has(normalizeIssuer(decodedToken.iss)) &&
          decodedToken.exp * 1000 > Date.now()
        ) {
          logVerbose("Refresh token cookie missing but access token still valid");
          tokens = undefined;
        } else {
          logVerbose("Refresh token cookie missing and access token invalid, clearing");
          tokens = null;
        }
      } else {
        if (decodedToken?.exp === undefined || decodedToken.iat === undefined) {
          logVerbose("Failed to decode access token, attempting refresh-token recovery");
          tokens = await refreshWithToken(refreshToken!);
        } else {
          const totalTokenLifetimeMs = decodedToken.exp * 1000 - decodedToken.iat * 1000;
          const minimumExpiration =
            Date.now() +
            Math.min(
              REQUIRED_TOKEN_LIFETIME_MS,
              Math.max(MINIMUM_REQUIRED_TOKEN_LIFETIME_MS, totalTokenLifetimeMs / 10),
            );
          if (decodedToken.exp * 1000 > minimumExpiration) {
            logVerbose("Token valid long enough, skipping refresh");
            tokens = undefined;
          } else {
            tokens = await refreshWithToken(refreshToken!);
          }
        }
      }

      if (tokens === undefined) {
        const client = authenticatedClient(currentToken);
        return {
          redirect: false,
          cookies: [],
          token: currentToken,
          convex: client,
          preloadQuery: buildPreloadQuery(client),
        };
      }

      const nextToken = tokens?.token ?? null;
      const client = authenticatedClient(nextToken);
      return {
        redirect: false,
        cookies: structuredAuthCookies(
          {
            token: nextToken,
            refreshToken: tokens?.refreshToken ?? null,
            verifier: null,
          },
          host,
          cookieConfig,
          cookieNamespace,
        ),
        token: nextToken,
        convex: client,
        preloadQuery: buildPreloadQuery(client),
      } satisfies PreloadResult;
    },
  };
}
