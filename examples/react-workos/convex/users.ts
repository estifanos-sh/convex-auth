import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { vWorkosProfile } from "@convex-dev/auth/methods/workos/server";

/**
 * Create the user row for a new WorkOS account and return its id. The row
 * keeps the WorkOS user id, which revoking WorkOS sessions and the admin
 * checks in workos.ts need.
 */
export const createUser = internalMutation({
  args: {
    provider: v.object({
      name: v.literal("workos"),
      accountId: v.string(),
      profile: vWorkosProfile,
    }),
  },
  returns: v.id("users"),
  handler: async (ctx, { provider }) => {
    return await ctx.db.insert("users", { workosId: provider.accountId });
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
    return { id: user._id };
  },
});
