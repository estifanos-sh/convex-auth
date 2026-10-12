/**
 * Everything about WorkOS that never varies between apps. That is the
 * endpoints, what the authorization request asks AuthKit for, and the shape
 * of the token response the profile is built from.
 *
 * This component serves WorkOS only, so these are constants rather than
 * configuration. The response type lives here because the exchange and the
 * profile mapping both read it.
 *
 * @module
 */

/** Where the browser is sent to sign in. */
export const AUTHORIZATION_ENDPOINT =
  "https://api.workos.com/user_management/authorize";

/** Where the authorization code is exchanged for the user. */
export const TOKEN_ENDPOINT =
  "https://api.workos.com/user_management/authenticate";

/**
 * What the authorization request asks for beyond the standard parameters.
 * `provider=authkit` sends the user to the hosted AuthKit sign-in, which
 * routes them to the environment's methods and to their organization's SSO
 * connection.
 */
export const AUTHORIZATION_PARAMS = { provider: "authkit" };

/**
 * AuthKit takes no scopes: what the sign-in returns is fixed by the
 * environment's configuration.
 */
export const SCOPES: string[] = [];

/** The WorkOS user fields the mapping reads. */
type WorkosUser = {
  id: string;
  email: string;
  email_verified: boolean;
  first_name?: string | null;
  last_name?: string | null;
  profile_picture_url?: string | null;
};

/**
 * The token response fields the exchange keeps, the ones that say who signed
 * in. WorkOS returns the user alongside its tokens, so this is where identity
 * comes from. This is what WorkOS is trusted to return; the response is not
 * validated against it at runtime. The access and refresh tokens are left out
 * on purpose: the app's session is Convex Auth's, not WorkOS's.
 */
export type WorkosAuthentication = {
  user: WorkosUser;
  organization_id?: string | null;
  authentication_method?: string;
};

/** The name this provider's accounts are namespaced under in the core. */
export const PROVIDER_NAME = "workos";
