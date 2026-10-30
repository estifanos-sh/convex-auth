/**
 * WorkOS's routes: the SSO callback, and the webhook that rings the
 * directory sync.
 *
 * @module
 */
import { httpActionGeneric, type HttpRouter } from "convex/server";
import { internal } from "./_generated/api.ts";
import { env } from "./_generated/server.ts";
import type { ClaimedRequest } from "../../lib/oauth/callback.ts";
import { buildCallbackRouter } from "../../lib/oauth/http.ts";
import {
  PROVIDER_NAME,
  TOKEN_ENDPOINT,
  USER_INFO_ENDPOINTS,
} from "./constants.ts";
import { verifyWebhookSignature } from "./webhook.ts";

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

/**
 * A webhook only starts a sync run: its payload is never applied, so a
 * dropped, repeated or reordered delivery changes nothing, and the event
 * stream stays the one source of truth.
 */
http.route({
  path: "/webhook",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const secret = await ctx.runQuery(internal.webhook.secret, {});
    if (secret === null) {
      return new Response("The webhook is not registered.", { status: 401 });
    }
    const verified = await verifyWebhookSignature({
      header: request.headers.get("WorkOS-Signature"),
      body: await request.text(),
      secret,
      now: Date.now(),
    });
    if (!verified) {
      return new Response("Invalid signature.", { status: 401 });
    }
    await ctx.runMutation(internal.sync.doorbell, {});
    return new Response(null, { status: 200 });
  }),
});

export default http;
