/**
 * Everything about WorkOS that never varies between apps: the SSO endpoints
 * and the shape of the SSO profile.
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
export const USER_INFO_ENDPOINTS: Record<keyof WorkosUserInfo, string> = {
  profile: "https://api.workos.com/sso/profile",
};

/** The SSO API takes no scopes: the connection decides what is returned. */
export const SCOPES: string[] = [];

/** The name this method's accounts are namespaced under in the core. */
export const PROVIDER_NAME = "workos";

/** The WorkOS SSO profile fields the mapping reads. */
type WorkosSsoProfile = {
  id: string;
  idp_id: string;
  organization_id?: string | null;
  connection_id: string;
  connection_type: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
};

/**
 * The responses the userinfo endpoints produce, keyed the way
 * {@link USER_INFO_ENDPOINTS} names them. This is what WorkOS is trusted to
 * return; the mapping checks the fields it relies on.
 */
export type WorkosUserInfo = { profile: WorkosSsoProfile };
