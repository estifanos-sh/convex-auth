/**
 * Group Connection provider (OIDC + SAML + SCIM).
 *
 * Adding `connection()` to your providers list enables group Connection
 * sign-in flows and registers the OIDC, SAML, and SCIM runtime HTTP
 * routes. Expose admin RPCs by wrapping the `auth.connection.*` facade in
 * your own `authMutation`/`authQuery` functions (authorize with
 * `auth.member.assert`).
 *
 * @module
 */

import type { ConnectionProviderConfig } from "../server/types";

/**
 * Create the group Connection provider.
 *
 * @param options - Optional Connection provider settings.
 * @param options.redirectURI - Override the callback URI used for provider
 *   initiated sign-in flows.
 * @returns A provider that enables the `auth.connection.*` admin facade and
 * registers the runtime Connection routes.
 *
 * @example
 * ```ts
 * import { connection } from "@estifanos-sh/convex-auth/providers";
 *
 * connection()
 * ```
 *
 * @example
 * ```ts
 * connection({ redirectURI: "https://app.example.com/auth/connection/callback" })
 * ```
 */
export function connection(options?: { redirectURI?: string }): ConnectionProviderConfig {
  return { id: "connection", type: "connection", redirectURI: options?.redirectURI };
}
