/**
 * `component.connection.secret.*` — encrypted IdP secrets for an
 * Connection connection (sub-resource of connection).
 *
 * @module
 */

import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import { vGroupConnectionSecretDoc } from "../documents";
import { vGroupConnectionSecretKind } from "../model";

/** Read a connection's secret by `(connectionId, kind)`, or `null` if none. */
export const get = query({
  args: {
    connectionId: v.id("GroupConnection"),
    kind: vGroupConnectionSecretKind,
  },
  returns: v.union(vGroupConnectionSecretDoc, v.null()),
  handler: async (ctx, { connectionId, kind }) => {
    return await ctx.db
      .query("GroupConnectionSecret")
      .withIndex("connection_id_kind", (idx) =>
        idx.eq("connectionId", connectionId).eq("kind", kind),
      )
      .first();
  },
});

/** Insert a connection secret, or patch it when it already exists (keyed by `(connectionId, kind)`). */
export const upsert = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    kind: vGroupConnectionSecretKind,
    ciphertext: v.string(),
    updatedAt: v.number(),
  },
  returns: v.id("GroupConnectionSecret"),
  handler: async (ctx, args) => {
    const { connectionId, ...rest } = args;
    const existing = await ctx.db
      .query("GroupConnectionSecret")
      .withIndex("connection_id_kind", (idx) =>
        idx.eq("connectionId", connectionId).eq("kind", args.kind),
      )
      .first();
    if (existing) {
      await ctx.db.patch("GroupConnectionSecret", existing._id, {
        connectionId: connectionId,
        ...rest,
      });
      return existing._id;
    }
    return await ctx.db.insert("GroupConnectionSecret", {
      connectionId: connectionId,
      ...rest,
    });
  },
});

/** Delete a connection's secret identified by `(connectionId, kind)`, if any. */
const remove = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    kind: vGroupConnectionSecretKind,
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, kind }) => {
    const existing = await ctx.db
      .query("GroupConnectionSecret")
      .withIndex("connection_id_kind", (idx) =>
        idx.eq("connectionId", connectionId).eq("kind", kind),
      )
      .first();
    if (existing) {
      await ctx.db.delete("GroupConnectionSecret", existing._id);
    }
    return null;
  },
});

export { remove };
