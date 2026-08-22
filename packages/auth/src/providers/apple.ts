/**
 * Apple OAuth provider.
 *
 * ```ts
 * import { apple } from "@estifanos-sh/convex-auth/providers/apple";
 *
 * apple({
 *   clientId: env.APPLE_CLIENT_ID,
 *   teamId: env.APPLE_TEAM_ID,
 *   keyId: env.APPLE_KEY_ID,
 *   privateKey: env.APPLE_PRIVATE_KEY,
 * })
 * ```
 *
 * @module
 */

import { importPKCS8, SignJWT } from "jose";

import { createOAuthClient, createOAuthProvider } from "../server/oauth/factory";
import { defaultOAuthRedirectUri } from "./redirect";

const DEFAULT_SCOPES = ["name", "email"];

/** Configuration for the {@link apple} provider. */
export interface AppleConfig {
  /** Services ID or app bundle identifier registered with Sign in with Apple. */
  clientId: string;
  /** Apple Developer team identifier used to sign client secrets. */
  teamId: string;
  /** Apple private key identifier. */
  keyId: string;
  /** Apple private key PEM contents or bytes. */
  privateKey: string | Uint8Array;
  /** Optional callback URL override. Defaults to the auth site URL plus `/callback/apple`. */
  redirectUri?: string;
  /** Optional OAuth scopes. Defaults to `name email`. */
  scopes?: string[];
  /** Account-linking strategy for existing users with matching email addresses. */
  accountLinking?: "verifiedEmail" | "none";
  /** On returning sign-in, refresh `User.name`/`image`/`email` from the new profile. Defaults to `true`. */
  updateProfileOnLogin?: boolean;
}

/**
 * Create an Apple OAuth provider.
 *
 * @param config - Apple Sign In client settings and signing key material.
 * @returns A configured Apple OAuth provider for `defineAuth`.
 * @throws {Error} When no callback URL can be derived and `redirectUri` is omitted.
 *
 * @example
 * ```ts
 * import { apple } from "@estifanos-sh/convex-auth/providers/apple";
 *
 * apple({
 *   clientId: env.APPLE_CLIENT_ID,
 *   teamId: env.APPLE_TEAM_ID,
 *   keyId: env.APPLE_KEY_ID,
 *   privateKey: env.APPLE_PRIVATE_KEY,
 * })
 * ```
 */
export function apple(config: AppleConfig) {
  const privateKey =
    typeof config.privateKey === "string"
      ? config.privateKey
      : new TextDecoder().decode(config.privateKey);
  const scopes = config.scopes ?? DEFAULT_SCOPES;
  return createOAuthProvider({
    id: "apple",
    provider: createOAuthClient({
      clientId: config.clientId,
      redirectUri: (redirectUri) =>
        config.redirectUri ?? defaultOAuthRedirectUri("apple", redirectUri),
      authorizationUrl: "https://appleid.apple.com/auth/authorize",
      tokenUrl: "https://appleid.apple.com/auth/token",
      pkce: "never",
      tokenAuth: "body",
      tokenParams: async () => ({
        client_secret: await new SignJWT({
          iss: config.teamId,
          aud: "https://appleid.apple.com",
          sub: config.clientId,
        })
          .setProtectedHeader({ alg: "ES256", kid: config.keyId, typ: "JWT" })
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(await importPKCS8(privateKey, "ES256")),
      }),
    }),
    scopes,
    accountLinking: config.accountLinking,
    updateProfileOnLogin: config.updateProfileOnLogin,
  });
}
