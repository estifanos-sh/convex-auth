/**
 * Reads of WorkOS organizations, as the copy holds them. They run as part of
 * the app's own queries and mutations, so they react to the sync like any
 * other data.
 *
 * @module
 */
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.ts";
import { find, pageOf } from "./copy.ts";
import { vOrganization } from "./validators.ts";

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), vOrganization),
  handler: async (ctx, args) => await find(ctx.db, "organization", args.id),
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vOrganization),
  handler: async (ctx, { paginationOpts: { numItems, cursor } }) =>
    await pageOf(
      "organization",
      ctx.db.query("objects").withIndex("object_id", (q) => {
        const organizations = q.eq("object", "organization");
        return cursor === null ? organizations : organizations.gt("id", cursor);
      }),
      numItems,
    ),
});
