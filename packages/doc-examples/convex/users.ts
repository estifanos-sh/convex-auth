import { v } from "convex/values";
import { vAppleProfile } from "@convex-dev/auth/methods/apple/server";
import { vGithubProfile } from "@convex-dev/auth/methods/github/server";
import { vGoogleProfile } from "@convex-dev/auth/methods/google/server";
import {
  vWorkosAccount,
  vWorkosProvision,
  vWorkosProvisionArgs,
} from "@estifanos-sh/convex-workos/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

// The `createUser` callback of each sign-in method of `auth.ts`.

export const createUserPassword = internalMutation({
  args: {
    method: v.object({
      name: v.literal("usernamePassword"),
      profile: v.object({}),
    }),
  },
  returns: v.id("users"),
  handler: async (ctx) => await ctx.db.insert("users", {}),
});

export const createUserEmailPassword = internalMutation({
  args: {
    method: v.object({
      name: v.literal("emailPassword"),
      profile: v.object({}),
    }),
  },
  returns: v.id("users"),
  handler: async (ctx) => await ctx.db.insert("users", {}),
});

export const createUserPasskey = internalMutation({
  args: {
    method: v.object({
      name: v.literal("usernamePasskey"),
      profile: v.object({}),
    }),
  },
  returns: v.id("users"),
  handler: async (ctx) => await ctx.db.insert("users", {}),
});

export const createUserGoogle = internalMutation({
  args: {
    method: v.object({
      name: v.literal("google"),
      profile: vGoogleProfile,
    }),
  },
  returns: v.id("users"),
  handler: async (ctx) => await ctx.db.insert("users", {}),
});

export const createUserApple = internalMutation({
  args: {
    method: v.object({
      name: v.literal("apple"),
      profile: vAppleProfile,
    }),
  },
  returns: v.id("users"),
  handler: async (ctx) => await ctx.db.insert("users", {}),
});

export const createUserGithub = internalMutation({
  args: {
    method: v.object({
      name: v.literal("github"),
      profile: vGithubProfile,
    }),
  },
  returns: v.id("users"),
  handler: async (ctx) => await ctx.db.insert("users", {}),
});

export const createUserWorkos = internalMutation({
  args: {
    method: v.object({
      name: v.literal("workos"),
      profile: vWorkosAccount({}),
    }),
  },
  returns: v.id("users"),
  handler: async (ctx, { method: { profile } }) => {
    const imported = await ctx.db
      .query("users")
      .withIndex("workosId", (q) => q.eq("workosId", profile.id))
      .unique();
    return imported?._id ?? (await ctx.db.insert("users", {}));
  },
});

// The `provision` callback of `provisioned.ts`: ready once a queue imported
// the user, which `importWorkos` stands in for.
export const provisionWorkos = internalMutation({
  args: vWorkosProvisionArgs({}),
  returns: vWorkosProvision,
  handler: async (ctx, { profile }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("workosId", (q) => q.eq("workosId", profile.id))
      .unique();
    if (user !== null) return { ready: true as const };
    await ctx.scheduler.runAfter(0, internal.users.importWorkos, {
      workosId: profile.id,
    });
    return { defer: true as const };
  },
});

/** Import the user of a WorkOS account, once however often it is filed. */
export const importWorkos = internalMutation({
  args: { workosId: v.string() },
  returns: v.null(),
  handler: async (ctx, { workosId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("workosId", (q) => q.eq("workosId", workosId))
      .unique();
    if (user === null) await ctx.db.insert("users", { workosId });
    return null;
  },
});
