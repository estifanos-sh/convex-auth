/**
 * WorkOS beyond sign-in: the directory sync, which keeps the app's tables in
 * step with its customers' WorkOS organizations and memberships (including
 * those their SCIM directories provision), and the functions an admin page
 * would call.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  vWorkosMembershipChange,
  vWorkosOrganizationChange,
  vWorkosPortalIntent,
  workosEnterprise,
} from "@convex-dev/auth/methods/workos/server";
import { components, internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";

export const enterprise = workosEnterprise(components.authWorkos, {
  allowedRedirectOrigins: ["http://localhost:5173"],
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

/** The caller's WorkOS user id, from their user row. */
export const callerWorkosId = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    return user?.workosId ?? null;
  },
});

/**
 * End the caller's WorkOS sessions on every device. It returns once WorkOS
 * has revoked them, and throws otherwise; the client calls `signOut` only
 * after it succeeds.
 */
export const signOutEverywhere = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const workosId: string | null = await ctx.runQuery(
      internal.workos.callerWorkosId,
      {},
    );
    if (workosId !== null) await enterprise.revoke(ctx, { user: workosId });
    return null;
  },
});

/**
 * A link to WorkOS's Admin Portal, where the organization's IT admin sets up
 * their SSO connection or SCIM directory. Anyone with the link can change the
 * organization's SSO, so only its admins get one.
 */
export const adminPortal = action({
  args: { organization: v.string(), intent: vWorkosPortalIntent },
  returns: v.object({ link: v.string() }),
  handler: async (ctx, args): Promise<{ link: string }> => {
    const workosId: string | null = await ctx.runQuery(
      internal.workos.callerWorkosId,
      {},
    );
    // Checked against WorkOS itself, not the synced members: an admin removed
    // a moment ago must not get a link before the next sync.
    const membership =
      workosId === null
        ? null
        : await enterprise.fetchMembership(ctx, {
            user: workosId,
            organization: args.organization,
          });
    if (
      workosId === null ||
      membership?.status !== "active" ||
      membership.role !== "admin"
    ) {
      throw new ConvexError(
        "Only an admin of the organization can open its portal.",
      );
    }
    // Tagged with the admin, so their portal sessions can be revoked in
    // WorkOS if they lose access.
    return await enterprise.portal(ctx, { ...args, externalUserId: workosId });
  },
});

/** The organizations the caller belongs to, from the synced members. */
export const myOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const user = await ctx.db.get("users", userId);
    if (user === null) return [];
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_workosUser", (q) => q.eq("workosUser", user.workosId))
      .take(100);
    return memberships.map((row) => ({
      organization: row.organization,
      role: row.role,
    }));
  },
});
