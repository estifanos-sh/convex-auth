/**
 * What the app reads from the copy: organizations, memberships, group
 * members, an email's organization and SSO connection, and how the sync is
 * doing. A tombstoned row is never returned.
 *
 * @module
 */
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { vDirectoryMember, vMembership, vOrganization } from "./changes.ts";
import { vSyncFailure } from "./schema.ts";
import { lane } from "./lane.ts";
import { Credentials, vBoundCredentials } from "./credentials.ts";
import { query } from "./_generated/server.ts";

function strip<
  T extends { _id: unknown; _creationTime: number; seen?: unknown },
>(doc: T) {
  const { _id, _creationTime, seen: _seen, ...rest } = doc;
  return rest;
}

export const organization = query({
  args: { workosId: v.string() },
  returns: v.union(v.null(), vOrganization),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("organizations")
      .withIndex("by_workosId", (q) => q.eq("workosId", args.workosId))
      .unique();
    return row === null || row.deleted ? null : strip(row);
  },
});

export const memberships = query({
  args: {
    of: v.union(
      v.object({ user: v.string() }),
      v.object({ organization: v.string() }),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(vMembership),
  handler: async (ctx, args) => {
    const { of } = args;
    const rows = ctx.db.query("memberships");
    const result = await (
      "user" in of
        ? rows.withIndex("by_user_deleted", (q) =>
            q.eq("user", of.user).eq("deleted", false),
          )
        : rows.withIndex("by_organization_deleted", (q) =>
            q.eq("organization", of.organization).eq("deleted", false),
          )
    ).paginate(args.paginationOpts);
    return { ...result, page: result.page.map(strip) };
  },
});

export const members = query({
  args: { group: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vDirectoryMember),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("directoryMembers")
      .withIndex("by_group_deleted", (q) =>
        q.eq("group", args.group).eq("deleted", false),
      )
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(strip) };
  },
});

/**
 * Where an email signs in, from the copy alone: the organization whose
 * verified domain it is in, and its SSO connection when it has exactly one
 * active. Pass the result to `startSignInWithWorkos` as `organizationId` or
 * `connectionId`.
 */
export const route = query({
  args: { email: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      organization: v.string(),
      connection: v.optional(v.string()),
      sso: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const domain = args.email.trim().toLowerCase().split("@").at(-1) ?? "";
    // Exactly the rows that decide: a verified claim on the domain, and the
    // active connections of its organization, never crowded out by pending,
    // inactive or deleted ones.
    const claim = await ctx.db
      .query("domains")
      .withIndex("by_domain_deleted_state", (q) =>
        q.eq("domain", domain).eq("deleted", false).eq("state", "verified"),
      )
      .first();
    if (claim === null) return null;
    const active = await ctx.db
      .query("connections")
      .withIndex("by_organization_deleted_state", (q) =>
        q
          .eq("organization", claim.organization)
          .eq("deleted", false)
          .eq("state", "active"),
      )
      .take(2);
    return {
      organization: claim.organization,
      connection: active.length === 1 ? active[0]?.workosId : undefined,
      sso: active.length > 0,
    };
  },
});

export const status = query({
  args: {},
  returns: v.object({
    bounded: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    error: v.optional(vSyncFailure),
    pending: v.boolean(),
    open: v.number(),
    bound: vBoundCredentials,
  }),
  handler: async (ctx) => {
    const row = await ctx.db.query("eventStream").first();
    const open = [
      ...(await ctx.db
        .query("backfills")
        .withIndex("by_phase", (q) => q.eq("phase", "list"))
        .take(100)),
      ...(await ctx.db
        .query("backfills")
        .withIndex("by_phase", (q) => q.eq("phase", "reconcile"))
        .take(100)),
    ];
    return {
      bounded: row?.bounded ?? false,
      cursor: row?.cursor ?? null,
      error: row?.error,
      pending:
        row?.work !== undefined &&
        (await lane.status(ctx, row.work)).state !== "finished",
      open: open.length,
      bound: await Credentials.report(),
    };
  },
});
