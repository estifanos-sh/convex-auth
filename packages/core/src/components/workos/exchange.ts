/**
 * WorkOS's code exchange.
 *
 * WorkOS's `authenticate` endpoint takes a JSON body rather than the standard
 * form-encoded exchange, returns no id_token, and has no userinfo endpoint an
 * access token can call. The user comes back in the token response itself,
 * so that response is what the ticket carries.
 *
 * @module
 */
import {
  fetchRefusingRedirects,
  type CodeExchange,
  type ExchangedTokens,
} from "../../lib/oauth/callback.ts";
import type { WorkosAuthentication } from "./constants.ts";

/**
 * The error code of a refused exchange, and nothing else. WorkOS's error
 * bodies can carry the user's email, their organizations, and a pending
 * authentication token, and the callback logs what it throws.
 */
function refusalCode(bodyText: string): string {
  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const code = body.code ?? body.error;
    return typeof code === "string" && /^[a-z_]{1,64}$/.test(code)
      ? code
      : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Exchange the code at WorkOS. The client ID and the API key go in the body,
 * with the PKCE verifier. WorkOS binds the code to the redirect URI it was
 * issued for, so the exchange sends none.
 *
 * An impersonated sign-in is refused here, before a ticket exists. A WorkOS
 * admin impersonating a user gets a token response for that user, and a
 * Convex Auth session carries no claim that says who is acting, so accepting
 * it would let the admin act as the user with nothing in the session to tell
 * them apart.
 */
export async function exchangeWorkosCode(
  args: CodeExchange,
): Promise<ExchangedTokens> {
  const response = await fetchRefusingRedirects(args.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      code_verifier: args.codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Token exchange failed with ${response.status}: ${refusalCode(response.bodyText)}`,
    );
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(response.bodyText) as Record<string, unknown>;
  } catch {
    // A parse error quotes the body, which would hold the user and tokens.
    throw new Error("WorkOS token response is not JSON");
  }
  if (typeof body.user !== "object" || body.user === null) {
    throw new Error("WorkOS token response has no user");
  }
  if (body.impersonator !== undefined && body.impersonator !== null) {
    throw new Error("WorkOS impersonated sign-ins are not accepted");
  }
  // Only the fields that say who signed in. WorkOS's access and refresh
  // tokens never reach the ticket: the app's session is Convex Auth's.
  const tokenResponse = {
    user: body.user,
    organization_id: body.organization_id,
    authentication_method: body.authentication_method,
  } as WorkosAuthentication;
  return { idToken: undefined, accessToken: undefined, tokenResponse };
}
