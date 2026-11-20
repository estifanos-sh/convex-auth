/**
 * WorkOS's route: the SSO callback.
 *
 * @module
 */
import type { HttpRouter } from "convex/server";
import type { ClaimedRequest } from "@convex-dev/auth/lib/oauth/callback";
import { buildCallbackRouter } from "@convex-dev/auth/lib/oauth/http";
import { internal } from "./_generated/api.ts";
import { env } from "./_generated/server.ts";
import {
  PROVIDER_NAME,
  TOKEN_ENDPOINT,
  USER_INFO_ENDPOINTS,
} from "./constants.ts";

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
    userInfoEndpoints: USER_INFO_ENDPOINTS,
  }),
});

export default http;
