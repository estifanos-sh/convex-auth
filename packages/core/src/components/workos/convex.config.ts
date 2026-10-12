import { defineComponent } from "convex/server";
import { v } from "convex/values";

/**
 * The WorkOS oauth component, for sign-in through WorkOS AuthKit. Install it
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
 * WorkOS authenticates the code exchange with the environment's API key,
 * which is why it is bound as `CLIENT_SECRET`.
 */
const component = defineComponent("authWorkos", {
  env: {
    CLIENT_ID: v.string(),
    CLIENT_SECRET: v.string(),
  },
});

export default component;
