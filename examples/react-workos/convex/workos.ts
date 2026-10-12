/**
 * WorkOS beyond sign-in: the directory sync, which keeps the app's tables in
 * step with its customers' WorkOS organizations and memberships (including
 * those their SCIM directories provision), and the functions an admin page
 * would call.
 */
import { v } from "convex/values";
import {
  vWorkosMembershipChange,
  vWorkosOrganizationChange,
  workosEnterprise,
} from "@convex-dev/auth/methods/workos/server";
import { components, internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";

export const enterprise = workosEnterprise(components.authWorkos, {
  on: {
    organization: internal.workos.organization,
    membership: internal.workos.membership,
  },
});

/** Run by the cron in crons.ts. */
export const sync = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await enterprise.sync(ctx),
});

/**
 * Where a work email signs in, for the sign-in page: its organization and SSO
 * connection, from the copy the sync keeps. Public, because the sign-in page
 * calls it before anyone is signed in; it reveals only which organization
 * claims a verified domain.
 */
export const route = query({
  args: { email: v.string() },
  handler: async (ctx, args) => await enterprise.route(ctx, args),
});

export const status = internalQuery({
  args: {},
  handler: async (ctx) => await enterprise.status(ctx),
});

// Each handler runs in the transaction that applies the change, once per
// change, so it does a constant amount of work.

export const organization = internalMutation({
  args: vWorkosOrganizationChange,
  returns: v.null(),
  handler: async (ctx, { kind, after }) => {
    const row = await ctx.db
      .query("organizations")
      .withIndex("by_workosId", (q) => q.eq("workosId", after.workosId))
      .unique();
    if (kind === "remove") {
      if (row !== null) await ctx.db.delete("organizations", row._id);
    } else if (row === null) {
      await ctx.db.insert("organizations", {
        workosId: after.workosId,
        name: after.name,
      });
    } else {
      await ctx.db.patch("organizations", row._id, { name: after.name });
    }
    return null;
  },
});

export const membership = internalMutation({
  args: vWorkosMembershipChange,
  returns: v.null(),
  handler: async (ctx, { kind, after }) => {
    const row = await ctx.db
      .query("members")
      .withIndex("by_membershipId", (q) => q.eq("membershipId", after.workosId))
      .unique();
    if (kind === "remove" || after.status !== "active") {
      if (row !== null) await ctx.db.delete("members", row._id);
    } else if (row === null) {
      await ctx.db.insert("members", {
        membershipId: after.workosId,
        organization: after.organization,
        workosUser: after.user,
        role: after.role,
      });
    } else {
      await ctx.db.patch("members", row._id, { role: after.role });
    }
    return null;
  },
});
