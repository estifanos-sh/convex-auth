import type { OAuthClientDomain } from "./client";
import type { OAuthCodeDomain } from "./code";
import type { OAuthRefreshDomain } from "./refresh";

/**
 * The full `auth.oauth` runtime surface (app-as-IdP; LEXICON §8a). Pins every
 * namespace to its domain interface, the way `connection`/`event` are pinned in
 * the auth runtime, so the surface is documented in one place and never drifts.
 */
export interface OAuthRuntimeDomain {
  /** OAuth client registry: `create`/`get`/`list`/`revoke`/`verify`. */
  client: OAuthClientDomain;
  /** Authorization-code lifecycle: `authorize` (mint) + `accept` (consume). */
  code: OAuthCodeDomain;
  /** Rotating refresh tokens: `create`/`exchange`/`revoke`. */
  refresh: OAuthRefreshDomain;
}
