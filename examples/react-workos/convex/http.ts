import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// A WorkOS webhook endpoint, set up in the dashboard, rings a sync. The sync
// reads the events from WorkOS's API with the API key, so the delivery
// carries nothing the app trusts, and needs no signature.
http.route({
  path: "/ring",
  method: "POST",
  handler: httpAction(async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.workos.sync, {});
    return new Response(null, { status: 200 });
  }),
});

export default http;
