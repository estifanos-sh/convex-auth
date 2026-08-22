import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64urlNoPadding } from "@oslojs/encoding";

import type {
  OAuthMaterializedConfig,
  OAuthProfile,
  OAuthRuntimeClient,
  OAuthTokens,
} from "../types";
import { normalizeOAuthTokenResponse } from "./normalize";

type OAuthTokenAuth = "basic" | "body" | "none";

/** @internal Error response returned by an OAuth token endpoint. */
export class OAuthProviderRequestError extends Error {
  constructor(
    readonly code: string,
    readonly description?: string,
  ) {
    super(`OAuth request error: ${code}`);
  }
}

/** @internal Network failure while contacting an OAuth token endpoint. */
export class OAuthProviderFetchError extends Error {
  constructor(cause: unknown) {
    super("Failed to send OAuth request", { cause });
  }
}

/** @internal Inputs for the small built-in OAuth 2.0 client. */
export interface OAuthClientConfig {
  clientId: string;
  clientSecret?: string | null;
  redirectUri: (runtimeRedirectUri?: string) => string;
  authorizationUrl: string;
  tokenUrl: string;
  pkce: OAuthRuntimeClient["pkce"];
  tokenAuth?: OAuthTokenAuth;
  tokenHeaders?: (redirectUri: string) => Record<string, string>;
  tokenParams?: () => Promise<Record<string, string>>;
}

function createCodeChallenge(codeVerifier: string) {
  return encodeBase64urlNoPadding(sha256(new TextEncoder().encode(codeVerifier)));
}

function basicCredentials(clientId: string, clientSecret: string) {
  return btoa(`${clientId}:${clientSecret}`);
}

async function parseTokenResponse(response: Response): Promise<OAuthTokens> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`OAuth token endpoint returned invalid JSON (${response.status}).`);
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`OAuth token endpoint returned an invalid response (${response.status}).`);
  }
  const tokenResponse = data as { error?: unknown; error_description?: unknown };
  const error = tokenResponse.error;
  if (typeof error === "string") {
    throw new OAuthProviderRequestError(
      error,
      typeof tokenResponse.error_description === "string"
        ? tokenResponse.error_description
        : undefined,
    );
  }
  if (!response.ok) {
    throw new Error(`OAuth token endpoint returned ${response.status}.`);
  }
  return normalizeOAuthTokenResponse(data);
}

/**
 * Create the minimal OAuth 2.0 authorization-code client used by bundled
 * providers. It deliberately owns only the protocol surface our runtime uses.
 *
 * @internal
 */
export function createOAuthClient(config: OAuthClientConfig): OAuthRuntimeClient {
  const tokenAuth = config.tokenAuth ?? "basic";
  return {
    pkce: config.pkce,
    createAuthorizationURL({ state, codeVerifier, scopes, nonce, loginHint, redirectUri }) {
      const url = new URL(config.authorizationUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri(redirectUri));
      url.searchParams.set("state", state);
      if (scopes.length > 0) {
        url.searchParams.set("scope", scopes.join(" "));
      }
      if (config.pkce !== "never" && codeVerifier !== undefined) {
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
      }
      if (nonce !== undefined) {
        url.searchParams.set("nonce", nonce);
      }
      if (loginHint !== undefined) {
        url.searchParams.set("login_hint", loginHint);
      }
      return url;
    },
    async validateAuthorizationCode({ code, codeVerifier, redirectUri: runtimeRedirectUri }) {
      const redirectUri = config.redirectUri(runtimeRedirectUri);
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
      if (config.pkce !== "never" && codeVerifier !== undefined) {
        body.set("code_verifier", codeVerifier);
      }

      const headers = new Headers({
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      });
      if (tokenAuth === "basic") {
        if (!config.clientSecret) {
          throw new Error("OAuth token authentication requires a client secret.");
        }
        headers.set(
          "Authorization",
          `Basic ${basicCredentials(config.clientId, config.clientSecret)}`,
        );
      } else if (tokenAuth === "body") {
        body.set("client_id", config.clientId);
        if (config.clientSecret) {
          body.set("client_secret", config.clientSecret);
        }
      }
      for (const [name, value] of Object.entries(config.tokenHeaders?.(redirectUri) ?? {})) {
        headers.set(name, value);
      }
      for (const [name, value] of Object.entries((await config.tokenParams?.()) ?? {})) {
        body.set(name, value);
      }

      let response: Response;
      try {
        response = await fetch(config.tokenUrl, { method: "POST", headers, body });
      } catch (error) {
        throw new OAuthProviderFetchError(error);
      }
      return parseTokenResponse(response);
    },
  };
}

/**
 * Internal provider config used to materialize OAuth providers for the auth runtime.
 *
 * @internal
 */
export interface OAuthProviderConfig<Id extends string = string> {
  readonly id: Id;
  readonly provider: OAuthRuntimeClient;
  readonly scopes: string[];
  readonly profile?: (tokens: OAuthTokens) => Promise<OAuthProfile>;
  readonly nonce?: boolean;
  readonly validateTokens?: (tokens: OAuthTokens, ctx: { nonce?: string }) => Promise<void>;
  readonly accountLinking?: "verifiedEmail" | "none";
  readonly updateProfileOnLogin?: boolean;
}

/**
 * Materialize a validated OAuth provider definition for internal auth runtime use.
 *
 * @internal
 */
export function createOAuthProvider<const Id extends string>(
  config: OAuthProviderConfig<Id>,
): OAuthMaterializedConfig<Id> {
  if (
    !config.provider ||
    typeof config.provider.createAuthorizationURL !== "function" ||
    typeof config.provider.validateAuthorizationCode !== "function"
  ) {
    throw new Error(
      `OAuth provider "${config.id}" must expose createAuthorizationURL() and validateAuthorizationCode().`,
    );
  }

  return {
    id: config.id,
    type: "oauth",
    provider: config.provider,
    scopes: [...config.scopes],
    profile: config.profile,
    nonce: config.nonce,
    validateTokens: config.validateTokens,
    accountLinking: config.accountLinking,
    updateProfileOnLogin: config.updateProfileOnLogin,
  };
}
