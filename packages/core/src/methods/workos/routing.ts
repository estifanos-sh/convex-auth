/**
 * Where a WorkOS sign-in goes: an organization or a connection, and the hints
 * the identity provider pre-fills.
 *
 * The routing rides on `redirectTo` as the query parameters of
 * {@link ROUTING_PARAMS}, because the shared OAuth client passes
 * `startSignIn` nothing but `redirectTo`. `startSignInWithWorkos` takes them
 * off before it records where the flow returns to, so the user comes back to
 * the URL without them.
 *
 * @module
 */

/**
 * Exactly one of `organizationId` and `connectionId` is required: WorkOS
 * picks the organization's active connection, or uses the one given.
 */
export type WorkosRouting = {
  /** A WorkOS organization id (`org_...`), as `organizationDomains.get` has. */
  organizationId?: string;
  /** A WorkOS connection id (`conn_...`). */
  connectionId?: string;
  /** Pre-fills the email at the identity provider, where it supports it. */
  loginHint?: string;
  /** Pre-fills the domain, for Microsoft OAuth and Google SAML connections. */
  domainHint?: string;
};

const ROUTING_PARAMS = {
  organizationId: "workos_organization_id",
  connectionId: "workos_connection_id",
  loginHint: "workos_login_hint",
  domainHint: "workos_domain_hint",
} as const satisfies Record<keyof WorkosRouting, string>;

const ROUTING_KEYS = Object.keys(ROUTING_PARAMS) as (keyof WorkosRouting)[];

const MAX_ROUTING_LENGTH = 256;

/**
 * `redirectTo` with `routing` added as its query parameters. A `redirectTo`
 * that is no URL is left for `startSignInWithWorkos` to refuse.
 */
export function addRouting(redirectTo: string, routing: WorkosRouting): string {
  if (!URL.canParse(redirectTo)) return redirectTo;
  const url = new URL(redirectTo);
  for (const key of ROUTING_KEYS) {
    const value = routing[key];
    if (value !== undefined) url.searchParams.set(ROUTING_PARAMS[key], value);
  }
  return url.toString();
}

/** Remove the routing from `url`'s query parameters, and return it. */
export function takeRouting(url: URL): WorkosRouting {
  const routing: WorkosRouting = {};
  for (const key of ROUTING_KEYS) {
    const value = url.searchParams.get(ROUTING_PARAMS[key]);
    if (value !== null) routing[key] = value;
    url.searchParams.delete(ROUTING_PARAMS[key]);
  }
  return routing;
}

/** WorkOS's authorize parameters for a routing, refusing a malformed one. */
export function authorizationParams(
  routing: WorkosRouting,
): Record<string, string> {
  const { organizationId, connectionId, loginHint, domainHint } = routing;
  if ((organizationId === undefined) === (connectionId === undefined)) {
    throw new Error(
      "startSignInWithWorkos takes exactly one of organizationId and connectionId",
    );
  }
  for (const value of [organizationId, connectionId, loginHint, domainHint]) {
    if (value !== undefined && value.length > MAX_ROUTING_LENGTH) {
      throw new Error("A WorkOS routing argument is too long");
    }
  }
  if (organizationId !== undefined && !organizationId.startsWith("org_")) {
    throw new Error("organizationId must be a WorkOS organization id");
  }
  if (connectionId !== undefined && !connectionId.startsWith("conn_")) {
    throw new Error("connectionId must be a WorkOS connection id");
  }
  const params: Record<string, string> = {};
  if (organizationId !== undefined) params.organization = organizationId;
  if (connectionId !== undefined) params.connection = connectionId;
  if (loginHint !== undefined) params.login_hint = loginHint;
  if (domainHint !== undefined) params.domain_hint = domainHint;
  return params;
}
