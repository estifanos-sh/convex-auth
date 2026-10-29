import { getAuthUserId } from "@convex-dev/auth/server";
import { vWorkosProfile } from "@convex-dev/auth/methods/workos/server";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";

const vProvider = v.object({
  name: v.literal("workos"),
  accountId: v.string(),
  profile: vWorkosProfile,
});

/** Create the user row for a new SSO account and return its id. */
export const createUser = internalMutation({
  args: { provider: vProvider },
  returns: v.id("users"),
  handler: async (ctx, { provider: { profile } }) => {
    return await ctx.db.insert("users", {
      email: profile.email,
      organizationId: profile.organizationId,
      idpId: profile.idpId,
    });
  },
});

/**
 * Refuse a sign-in the customer's directory has deprovisioned, which can come
 * before the identity provider stops signing the user in.
 */
export const onSignIn = internalMutation({
  args: { userId: v.id("users"), provider: vProvider },
  returns: v.null(),
  handler: async (ctx, { provider: { profile } }) => {
    if (profile.organizationId === undefined) return null;
    const entries = await ctx.runQuery(
      components.authWorkos.directory.findUsers,
      { organizationId: profile.organizationId, idpId: profile.idpId },
    );
    if (entries.some((entry) => entry.state !== "active")) {
      throw new ConvexError("Your organization has deactivated this account.");
    }
    return null;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      return null;
    }
    return { id: user._id, email: user.email };
  },
});
