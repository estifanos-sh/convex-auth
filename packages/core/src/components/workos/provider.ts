/**
 * The functions WorkOS's component registers over its request, ticket and
 * account tables.
 *
 * @module
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.ts";
import { env, internalMutation, mutation, query } from "./_generated/server.ts";
import {
  AUTHORIZATION_REQUEST_TTL_MS,
  insertAuthorizationRequest,
} from "../../lib/oauth/dbHelpers.ts";
import { buildProviderFunctions } from "../../lib/oauth/providerFunctions.ts";

export const {
  claimAuthorizationRequest,
  createTicket,
  claimTicket,
  getUserIdByAccount,
  _internal_dangerous_createAccount,
} = buildProviderFunctions<
  Doc<"authorizationRequests">,
  Doc<"tickets">,
  Doc<"accounts">
>({
  query,
  mutation,
  internalMutation,
  clientId: () => env.CLIENT_ID,
});

/**
 * Record an in-flight authorization request, as every OAuth component's
 * `_internal_dangerous_createAuthorizationRequest` does, under `callbackUrl`
 * when one is given: the `redirect_uri` of an app that serves the callback
 * from its own domain through a proxy. Without it, the request is recorded
 * under the component's own callback route.
 *
 * DANGER: the component does not validate `redirectTo`, and the callback
 * sends the one-time ticket code there. `startSignInWithWorkos` checks it
 * against `allowedRedirectOrigins` first; a caller that skips the check lets
 * an attacker get a victim's ticket code, and sign in as the victim.
 */
export const _internal_dangerous_createAuthorizationRequest = mutation({
  args: {
    stateHash: v.string(),
    redirectTo: v.string(),
    codeVerifier: v.string(),
    callbackUrl: v.optional(v.string()),
  },
  returns: v.object({ clientId: v.string(), callbackUrl: v.string() }),
  handler: async (ctx, { callbackUrl, ...fields }) => {
    if (callbackUrl === undefined) {
      const recorded = await insertAuthorizationRequest<
        Doc<"authorizationRequests">
      >(ctx, fields);
      return { clientId: env.CLIENT_ID, callbackUrl: recorded.callbackUrl };
    }
    const protocol = URL.canParse(callbackUrl)
      ? new URL(callbackUrl).protocol
      : null;
    if (protocol !== "https:" && protocol !== "http:") {
      throw new Error("callbackUrl must be an absolute http(s) URL");
    }
    await ctx.db.insert("authorizationRequests", {
      ...fields,
      callbackUrl,
      expiresAt: Date.now() + AUTHORIZATION_REQUEST_TTL_MS,
    });
    return { clientId: env.CLIENT_ID, callbackUrl };
  },
});
