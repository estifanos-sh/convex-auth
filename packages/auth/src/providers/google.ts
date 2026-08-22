/**
 * Google OAuth provider.
 *
 * ```ts
 * import { google } from "@estifanos-sh/convex-auth/providers/google";
 *
 * google({
 *   clientId: env.GOOGLE_CLIENT_ID,
 *   clientSecret: env.GOOGLE_CLIENT_SECRET,
 * })
 * ```
 *
 * @module
 */

import { createOAuthClient, createOAuthProvider } from "../server/oauth/factory";
import { defaultOAuthRedirectUri } from "./redirect";

const DEFAULT_SCOPES = ["openid", "profile", "email"];

/** Configuration for the {@link google} provider. */
export interface GoogleConfig {
  /** OAuth client ID from the Google Cloud console. */
  clientId: string;
  /** OAuth client secret from the Google Cloud console. */
  clientSecret: string;
  /** Optional callback URL override. Defaults to the auth site URL plus `/callback/google`. */
  redirectUri?: string;
  /** Optional OAuth scopes. Defaults to `openid profile email`. */
  scopes?: string[];
  /** Account-linking strategy for existing users with matching email addresses. */
  accountLinking?: "verifiedEmail" | "none";
  /** On returning sign-in, refresh `User.name`/`image`/`email` from the new profile. Defaults to `true`. */
  updateProfileOnLogin?: boolean;
}

/**
 * Create a Google OAuth provider.
 *
 * Uses the Google OpenID Connect flow and requests `openid profile email` by
 * default.
 *
 * @param config - Google OAuth client settings.
 * @returns A configured Google OAuth provider for `defineAuth`.
 * @throws {Error} When no callback URL can be derived and `redirectUri` is omitted.
 *
 * @example
 * ```ts
 * import { google } from "@estifanos-sh/convex-auth/providers/google";
 *
 * google({
 *   clientId: env.GOOGLE_CLIENT_ID,
 *   clientSecret: env.GOOGLE_CLIENT_SECRET,
 * })
 * ```
 */
export function google(config: GoogleConfig) {
  const scopes = config.scopes ?? DEFAULT_SCOPES;
  return createOAuthProvider({
    id: "google",
    provider: createOAuthClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: (redirectUri) =>
        config.redirectUri ?? defaultOAuthRedirectUri("google", redirectUri),
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      pkce: "required",
    }),
    scopes,
    accountLinking: config.accountLinking,
    updateProfileOnLogin: config.updateProfileOnLogin,
  });
}
