/**
 * Where a WorkOS sign-in goes, as a {@link WorkosRoute}.
 *
 * The route rides on `redirectTo` as the `workos_*` query parameters of
 * {@link PARAMS}, because the shared OAuth client passes `startSignIn`
 * nothing but `redirectTo`. {@link addRoute} is the one place that writes
 * them, on the client, and {@link takeRoute} the one place that reads them,
 * on the server, which also takes them off so the user comes back to the URL
 * without them.
 *
 * @module
 */

/** Pre-fills at the identity provider, where it supports them. */
export type WorkosHints = {
  /** Pre-fills the email. */
  loginHint?: string;
  /** Pre-fills the domain, for Microsoft OAuth and Google SAML connections. */
  domainHint?: string;
};

/**
 * Where a WorkOS sign-in goes. WorkOS signs in through an organization's
 * active connection or through a given connection; `startSignInWithWorkos`
 * refuses a `hint` route, which names neither, and a `default` route, which
 * carries nothing.
 */
export type WorkosRoute =
  | ({
      kind: "organization";
      /** A WorkOS organization id (`org_...`), as `organizationDomains.get` has. */
      organizationId: string;
    } & WorkosHints)
  | ({
      kind: "connection";
      /** A WorkOS connection id (`conn_...`). */
      connectionId: string;
    } & WorkosHints)
  | ({ kind: "hint" } & WorkosHints)
  | { kind: "default" };

const PARAMS = {
  organizationId: "workos_organization_id",
  connectionId: "workos_connection_id",
  loginHint: "workos_login_hint",
  domainHint: "workos_domain_hint",
} as const;

type RouteField = keyof typeof PARAMS;

const FIELDS = Object.keys(PARAMS) as RouteField[];

const MAX_LENGTH = 256;

/**
 * `redirectTo` with `route` set as its query parameters. A `redirectTo` that
 * is no URL is left for `startSignInWithWorkos` to refuse.
 */
export function addRoute(redirectTo: string, route: WorkosRoute): string {
  if (!URL.canParse(redirectTo)) return redirectTo;
  const url = new URL(redirectTo);
  const { kind: _kind, ...rest } = route;
  const fields: Partial<Record<RouteField, string>> = rest;
  for (const field of FIELDS) {
    const value = fields[field];
    if (value !== undefined) url.searchParams.set(PARAMS[field], value);
  }
  return url.toString();
}

/**
 * Read the route off `url`'s query parameters and remove them from `url`.
 * Throws on a route no client builds: both an organization and a connection,
 * a malformed id, or a value too long.
 */
export function takeRoute(url: URL): WorkosRoute {
  const read: Partial<Record<RouteField, string>> = {};
  for (const field of FIELDS) {
    const value = url.searchParams.get(PARAMS[field]);
    url.searchParams.delete(PARAMS[field]);
    if (value === null) continue;
    if (value.length > MAX_LENGTH) {
      throw new Error("A WorkOS routing argument is too long");
    }
    read[field] = value;
  }
  const { organizationId, connectionId, loginHint, domainHint } = read;
  const hints: WorkosHints = {
    ...(loginHint === undefined ? {} : { loginHint }),
    ...(domainHint === undefined ? {} : { domainHint }),
  };
  if (organizationId !== undefined && connectionId !== undefined) {
    throw new Error(
      "startSignInWithWorkos takes exactly one of organizationId and connectionId",
    );
  }
  if (organizationId !== undefined) {
    if (!organizationId.startsWith("org_")) {
      throw new Error("organizationId must be a WorkOS organization id");
    }
    return { kind: "organization", organizationId, ...hints };
  }
  if (connectionId !== undefined) {
    if (!connectionId.startsWith("conn_")) {
      throw new Error("connectionId must be a WorkOS connection id");
    }
    return { kind: "connection", connectionId, ...hints };
  }
  if (loginHint !== undefined || domainHint !== undefined) {
    return { kind: "hint", ...hints };
  }
  return { kind: "default" };
}

/** WorkOS's authorize parameters for a route, refusing one WorkOS can't sign in by. */
export function authorizationParams(
  route: WorkosRoute,
): Record<string, string> {
  if (route.kind === "hint" || route.kind === "default") {
    throw new Error(
      "startSignInWithWorkos takes exactly one of organizationId and connectionId",
    );
  }
  const params: Record<string, string> =
    route.kind === "organization"
      ? { organization: route.organizationId }
      : { connection: route.connectionId };
  if (route.loginHint !== undefined) params.login_hint = route.loginHint;
  if (route.domainHint !== undefined) params.domain_hint = route.domainHint;
  return params;
}
