import { defineComponent } from "convex/server";
import { v } from "convex/values";

/**
 * The WorkOS component, for enterprise SSO and SCIM directory sync through
 * WorkOS. It serves the SSO callback, keeps a copy of the environment's
 * organizations, domains, SSO connections and directories, and generates
 * Admin Portal links. Install it once, with the `httpPrefix` its routes are
 * served under, and bind the environment's client ID and API key:
 *
 * ```ts
 * app.use(workos, {
 *   httpPrefix: "/workos",
 *   env: {
 *     CLIENT_ID: app.env.AUTH_WORKOS_CLIENT_ID,
 *     CLIENT_SECRET: app.env.AUTH_WORKOS_API_KEY,
 *     WEBHOOK_SECRET: app.env.AUTH_WORKOS_WEBHOOK_SECRET,
 *   },
 * });
 * ```
 *
 * WorkOS authenticates the code exchange and every API call with the
 * environment's API key, which is why it is bound as `CLIENT_SECRET`.
 * `WEBHOOK_SECRET` is optional: with it, the component serves a webhook at
 * `<httpPrefix>/webhook` that starts a directory sync as soon as WorkOS has a
 * change.
 */
const component = defineComponent("authWorkos", {
  env: {
    CLIENT_ID: v.string(),
    CLIENT_SECRET: v.string(),
    WEBHOOK_SECRET: v.optional(v.string()),
  },
});

export default component;
