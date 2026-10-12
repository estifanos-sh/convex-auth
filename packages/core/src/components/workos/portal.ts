/**
 * WorkOS's Admin Portal, where a customer's IT admin configures their own SSO
 * connection, SCIM directory, domains and the rest.
 *
 * @module
 */
import { ConvexError, Infer, v } from "convex/values";
import { Credentials } from "./credentials.ts";
import { matches } from "./wire.ts";
import { Api } from "./workosApi.ts";
import { action } from "./_generated/server.ts";

/** What the portal opens to. */
export const vPortalIntent = v.union(
  v.literal("sso"),
  v.literal("dsync"),
  v.literal("audit_logs"),
  v.literal("log_streams"),
  v.literal("domain_verification"),
  v.literal("certificate_renewal"),
  v.literal("bring_your_own_key"),
);
export type PortalIntent = Infer<typeof vPortalIntent>;

const vLink = v.object({ link: v.string() });

/**
 * A portal link for one organization. WorkOS expires it after five minutes,
 * and it is handed straight back, never stored. `externalUserId` is the app's
 * id for the admin it is for, which WorkOS keeps so the link and the portal
 * sessions it opens can be revoked from the WorkOS dashboard.
 */
export const link = action({
  args: {
    organization: v.string(),
    intent: vPortalIntent,
    returnUrl: v.optional(v.string()),
    successUrl: v.optional(v.string()),
    externalUserId: v.optional(v.string()),
  },
  returns: vLink,
  handler: async (_ctx, args) => {
    const reply = await new Api(Credentials.read()).send(
      "POST",
      "/portal/generate_link",
      {
        organization: args.organization,
        intent: args.intent,
        return_url: args.returnUrl,
        success_url: args.successUrl,
        external_user_id: args.externalUserId,
      },
    );
    if (!matches(vLink, reply.body)) {
      throw new ConvexError({
        code: "WORKOS_UNREADABLE",
        message: "WorkOS returned no portal link",
        status: 502,
      });
    }
    return { link: (reply.body as { link: string }).link };
  },
});
