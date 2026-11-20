/**
 * WorkOS Admin Portal links, so a customer's IT admin sets up their SSO
 * connection, their SCIM directory and their domain themselves.
 *
 * @module
 */
import { v } from "convex/values";
import { action, env } from "./_generated/server.ts";
import { vIntent } from "./validators.ts";
import { Workos } from "./workos.ts";

/**
 * Generate a short-lived Admin Portal link for one organization. The link is
 * returned, never stored. This does no authorization: the app decides who may
 * open its organization's portal before it calls this.
 */
export const link = action({
  args: {
    organizationId: v.string(),
    intent: vIntent,
    /** Where the portal's back button goes. */
    returnUrl: v.optional(v.string()),
    /** Where the portal goes once the setup is done. */
    successUrl: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (_ctx, args) =>
    await new Workos(env.CLIENT_SECRET).link({
      organization: args.organizationId,
      intent: args.intent,
      return_url: args.returnUrl,
      success_url: args.successUrl,
    }),
});
