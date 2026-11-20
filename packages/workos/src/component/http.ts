/**
 * WorkOS's routes: the SSO callback, and the webhook that rings the app.
 *
 * @module
 */
import { httpActionGeneric, type HttpRouter } from "convex/server";
import type { ClaimedRequest } from "@convex-dev/auth/lib/oauth/callback";
import { buildCallbackRouter } from "@convex-dev/auth/lib/oauth/http";
import { internal } from "./_generated/api.ts";
import { env } from "./_generated/server.ts";
import {
  PROVIDER_NAME,
  TOKEN_ENDPOINT,
  USER_INFO_ENDPOINTS,
} from "./constants.ts";
import { ringHandle, verifyWebhookSignature } from "./webhook.ts";

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
 * A verified delivery schedules the app's `onRing` action, which pulls. The
 * delivery's payload is not applied: WorkOS does not deliver in order, and
 * the Events API does.
 */
http.route({
  path: "/webhook",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const endpoint = await ctx.runQuery(internal.webhook.read, {});
    if (endpoint === null) {
      return new Response("The webhook is not registered.", { status: 401 });
    }
    const verified = await verifyWebhookSignature({
      header: request.headers.get("WorkOS-Signature"),
      body: await request.text(),
      secret: endpoint.secret,
      now: Date.now(),
    });
    if (!verified) return new Response("Invalid signature.", { status: 401 });
    await ctx.scheduler.runAfter(0, ringHandle(endpoint.onRing), {});
    return new Response(null, { status: 200 });
  }),
});

export default http;
