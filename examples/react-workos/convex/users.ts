import { getAuthUserId } from "@convex-dev/auth/server";
import {
  vWorkosAccount,
  type WorkosDirectoryUser,
} from "@estifanos-sh/convex-workos/server";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, type MutationCtx, query } from "./_generated/server";

const vMethod = v.object({
  name: v.literal("workos"),
  profile: vWorkosAccount({}),
});

/** Create the user row for a new SSO account and return its id. */
export const createUser = internalMutation({
  args: { method: vMethod },
  returns: v.id("users"),
  handler: async (ctx, { method: { profile } }) => {
    return await ctx.db.insert("users", {
      email: profile.email,
      organizationId: profile.organization_id,
      idpId: profile.idp_id,
    });
  },
});

/**
 * Refuse a sign-in the customer's directory has deprovisioned, which can come
 * before the identity provider stops signing the user in.
 */
export const onSignIn = internalMutation({
  args: { userId: v.id("users"), method: vMethod },
  returns: v.null(),
  handler: async (ctx, { method: { profile } }) => {
    if (profile.organization_id === undefined) return null;
    const entries = await ctx.runQuery(
      components.authWorkos.directoryUsers.list,
      {
        filter: {
          organization: profile.organization_id,
          idpId: profile.idp_id,
        },
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    if (entries.page.some((entry) => entry.state !== "active")) {
      throw new ConvexError("Your organization has deactivated this account.");
    }
    return null;
  },
});

/** Mark the directory user's app users and sign them out everywhere. */
export async function deprovision(ctx: MutationCtx, user: WorkosDirectoryUser) {
  const users = await ctx.db
    .query("users")
    .withIndex("organizationId_idpId", (q) =>
      q.eq("organizationId", user.organization_id).eq("idpId", user.idp_id),
    )
    .collect();
  for (const row of users) {
    await ctx.db.patch("users", row._id, { deprovisioned: true });
    const sessions = await ctx.runQuery(components.auth.public.listSessions, {
      userId: row._id,
    });
    await ctx.runMutation(components.auth.public.revokeSessions, {
      sessionIds: sessions.map((session) => session.sessionId),
    });
  }
}

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
