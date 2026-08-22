/**
 * `component.connection.scim.config.*` — SCIM provisioning config
 * for an Connection connection (sub-resource of connection).
 *
 * Reads collapse into one overloaded `get`
 * (`{ connectionId }` or `{ tokenHash }`).
 *
 * @module
 */

import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import { vGroupConnectionScimConfigDoc } from "../../documents";
import { vScimStatus } from "../../model";

/**
 * Read a SCIM config. Overloaded: lookup by `{ tokenHash }` (bearer-token
 * resolution) or by `{ connectionId }`. Returns `null` when nothing matches.
 */
export const get = query({
  args: {
    connectionId: v.optional(v.id("GroupConnection")),
    tokenHash: v.optional(v.string()),
  },
  returns: v.union(vGroupConnectionScimConfigDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.tokenHash !== undefined) {
      return await ctx.db
        .query("GroupConnectionScimConfig")
        .withIndex("token_hash", (idx) => idx.eq("tokenHash", args.tokenHash!))
        .first();
    }
    if (args.connectionId === undefined) return null;
    return await ctx.db
      .query("GroupConnectionScimConfig")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", args.connectionId!))
      .first();
  },
});

/** Insert a SCIM config, or patch it when one already exists for the connection (keyed by `connectionId`). */
export const upsert = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    status: vScimStatus,
    basePath: v.string(),
    tokenHash: v.string(),
    lastRotatedAt: v.optional(v.number()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupConnectionScimConfig"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("GroupConnectionScimConfig")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", args.connectionId))
      .first();
    if (existing) {
      await ctx.db.patch("GroupConnectionScimConfig", existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("GroupConnectionScimConfig", args);
  },
});
