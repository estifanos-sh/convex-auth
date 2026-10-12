/**
 * WorkOS's callback.
 *
 * @module
 */
import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api.ts";
import { env } from "./_generated/server.ts";
import type { ClaimedRequest } from "../../lib/oauth/callback.ts";
import { buildCallbackRouter } from "../../lib/oauth/http.ts";
import { exchangeWorkosCode } from "./exchange.ts";
import { PROVIDER_NAME, TOKEN_ENDPOINT } from "./constants.ts";

const http: HttpRouter = buildCallbackRouter<ClaimedRequest>({
  claim: (ctx, stateHash) =>
    ctx.runMutation(internal.provider.claimAuthorizationRequest, { stateHash }),
  mintTicket: (ctx, request, ticket) =>
    ctx.runMutation(internal.provider.createTicket, {
      stateHash: request.stateHash,
      ...ticket,
    }),
  exchangeConfig: () => ({
    providerName: PROVIDER_NAME,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: env.CLIENT_ID,
    clientSecret: () => env.CLIENT_SECRET,
    // WorkOS returns no id_token and has no userinfo endpoint for an access
    // token; the user comes back in the token response itself.
    exchange: exchangeWorkosCode,
  }),
});

export default http;
