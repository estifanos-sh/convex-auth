/**
 * Normalize a raw OAuth token endpoint response into the stable
 * {@link OAuthTokens} contract.
 *
 * @module
 */

import type { OAuthTokens } from "../types";

type OAuthTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

function tokenResponseFields(value: unknown): OAuthTokenResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as OAuthTokenResponse;
}

/**
 * Convert a raw OAuth/OIDC token response body into {@link OAuthTokens},
 * extracting the standard `access_token`, `refresh_token`, and `id_token`
 * fields, converting `expires_in` (seconds) into an absolute expiry `Date`,
 * and splitting the space/comma-delimited `scope` string into an array.
 *
 * The original response body is preserved on `raw`.
 *
 * @internal
 */
export function normalizeOAuthTokenResponse(raw: unknown): OAuthTokens {
  const fields = tokenResponseFields(raw);
  const rawScopes = typeof fields.scope === "string" ? fields.scope : undefined;
  const expiresInSeconds = typeof fields.expires_in === "number" ? fields.expires_in : undefined;
  return {
    accessToken: typeof fields.access_token === "string" ? fields.access_token : undefined,
    refreshToken: typeof fields.refresh_token === "string" ? fields.refresh_token : undefined,
    idToken: typeof fields.id_token === "string" ? fields.id_token : undefined,
    accessTokenExpiresAt:
      expiresInSeconds === undefined ? undefined : new Date(Date.now() + expiresInSeconds * 1000),
    scopes: rawScopes
      ? rawScopes
          .split(/[\s,]+/)
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0)
      : undefined,
    raw,
  };
}
