import { defineComponent } from "convex/server";
import { v } from "convex/values";
import workpool from "@convex-dev/workpool/convex.config.js";

/**
 * The WorkOS component, Convex Auth's enterprise provider: sign-in through
 * WorkOS AuthKit (with routing to an organization's SSO connection), and a
 * copy of the WorkOS environment's organizations, users, memberships, SSO
 * connections and SCIM directories, kept by the directory sync. Install it
 * once, with the `httpPrefix` its callback is served under, and bind the
 * environment's client ID and API key:
 *
 * ```ts
 * app.use(workos, {
 *   httpPrefix: "/oauth/workos",
 *   env: {
 *     CLIENT_ID: app.env.AUTH_WORKOS_CLIENT_ID,
 *     CLIENT_SECRET: app.env.AUTH_WORKOS_API_KEY,
 *   },
 * });
 * ```
 *
 * WorkOS authenticates the code exchange and every API call with the
 * environment's API key, which is why it is bound as `CLIENT_SECRET`.
 *
 * Mounts a workpool, the directory sync's lane: one serial queue that runs
 * every pass over the event stream and every backfill step, so a listing
 * never races the stream on a row.
 */
const component = defineComponent("authWorkos", {
  env: {
    CLIENT_ID: v.string(),
    CLIENT_SECRET: v.string(),
  },
});
component.use(workpool, { name: "lane" });

export default component;
