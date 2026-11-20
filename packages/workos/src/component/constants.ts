/**
 * WorkOS's SSO endpoints, which never vary between apps.
 *
 * Sign-in goes through WorkOS's standalone SSO API, not AuthKit (User
 * Management). The SSO API creates no WorkOS users and no WorkOS sessions, so
 * the session stays Convex Auth's alone.
 *
 * @module
 */

/** Where the browser is sent to sign in. */
export const AUTHORIZATION_ENDPOINT = "https://api.workos.com/sso/authorize";

/** Where the authorization code is exchanged for an access token. */
export const TOKEN_ENDPOINT = "https://api.workos.com/sso/token";

/**
 * What the callback fetches with the access token. WorkOS returns no
 * id_token; the profile endpoint is where identity comes from.
 */
export const USER_INFO_ENDPOINTS = {
  profile: "https://api.workos.com/sso/profile",
};

/** The provider's name, for the accounts and the error messages. */
export const PROVIDER_NAME = "workos";
