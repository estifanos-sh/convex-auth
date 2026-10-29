/**
 * Reads of the copy the directory sync keeps. They run as part of the app's
 * own queries and mutations, so they react to the sync like any other data.
 *
 * @module
 */
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.ts";
import {
  directoryOf,
  groupOf,
  memberOf,
  organizationOf,
  userOf,
} from "./mirror.ts";
import {
  vWorkosDirectory,
  vWorkosDirectoryGroup,
  vWorkosDirectoryMember,
  vWorkosDirectoryUser,
  vWorkosOrganization,
} from "./schema.ts";

/**
 * Where to send an email address to sign in: the organization that verified
 * the email's domain, when it has an active SSO connection. Pass its
 * `organizationId` to `startSignInWithWorkos`. Returns null for an address
 * that no organization signs in with SSO.
 */
export const route = query({
  args: { email: v.string() },
  returns: v.union(v.null(), v.object({ organizationId: v.string() })),
  handler: async (ctx, args) => {
    const at = args.email.lastIndexOf("@");
    if (at === -1) return null;
    const domain = args.email.slice(at + 1).toLowerCase();
    const claims = await ctx.db
      .query("domains")
      .withIndex("domain", (q) => q.eq("domain", domain))
      .collect();
    for (const claim of claims) {
      if (claim.state !== "verified") continue;
      const connection = await ctx.db
        .query("connections")
        .withIndex("organizationId_state", (q) =>
          q.eq("organizationId", claim.organizationId).eq("state", "active"),
        )
        .first();
      if (connection !== null) {
        return { organizationId: claim.organizationId };
      }
    }
    return null;
  },
});

export const getOrganization = query({
  args: { id: v.string() },
  returns: v.union(v.null(), vWorkosOrganization),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("organizations")
      .withIndex("id", (q) => q.eq("id", args.id))
      .unique();
    return row === null ? null : organizationOf(row);
  },
});

export const listDirectories = query({
  args: { organizationId: v.string() },
  returns: v.array(vWorkosDirectory),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("directories")
      .withIndex("organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    return rows.filter((row) => row.deleted !== true).map(directoryOf);
  },
});

export const getUser = query({
  args: { id: v.string() },
  returns: v.union(v.null(), vWorkosDirectoryUser),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("directoryUsers")
      .withIndex("id", (q) => q.eq("id", args.id))
      .unique();
    return row === null ? null : userOf(row);
  },
});

/**
 * The directory users of an organization with this identity provider id. An
 * SSO profile carries the same `organizationId` and `idpId`, which is how a
 * signed-in user is matched to their directory entry.
 */
export const findUsers = query({
  args: { organizationId: v.string(), idpId: v.string() },
  returns: v.array(vWorkosDirectoryUser),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("directoryUsers")
      .withIndex("organizationId_idpId", (q) =>
        q.eq("organizationId", args.organizationId).eq("idpId", args.idpId),
      )
      .collect();
    return rows.map(userOf);
  },
});

export const listUsers = query({
  args: { directoryId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vWorkosDirectoryUser),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("directoryUsers")
      .withIndex("directoryId", (q) => q.eq("directoryId", args.directoryId))
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map(userOf) };
  },
});

export const listGroups = query({
  args: { directoryId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vWorkosDirectoryGroup),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("directoryGroups")
      .withIndex("directoryId_id", (q) => q.eq("directoryId", args.directoryId))
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map(groupOf) };
  },
});

/** The groups a directory user is a member of. */
export const listUserGroups = query({
  args: { userId: v.string() },
  returns: v.array(vWorkosDirectoryGroup),
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("directoryMembers")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
    const groups = [];
    for (const membership of memberships) {
      const group = await ctx.db
        .query("directoryGroups")
        .withIndex("id", (q) => q.eq("id", membership.groupId))
        .unique();
      if (group !== null) groups.push(groupOf(group));
    }
    return groups;
  },
});

export const listMembers = query({
  args: { groupId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vWorkosDirectoryMember),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("directoryMembers")
      .withIndex("groupId_userId", (q) => q.eq("groupId", args.groupId))
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map(memberOf) };
  },
});
