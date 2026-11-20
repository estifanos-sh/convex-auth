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
import { find, only, pageOf } from "./copy.ts";
import { vOrganization } from "./validators.ts";

/**
 * An organization by WorkOS's `id`, or by its `externalId`, the app's own id
 * that WorkOS keeps on it to link it to the app's entity, and keeps unique
 * in an environment. Null when the copy holds none.
 */
export const get = query({
  args: {
    by: v.union(
      v.object({ id: v.string() }),
      v.object({ externalId: v.string() }),
    ),
  },
  returns: v.union(v.null(), vOrganization),
  handler: async (ctx, { by }) => {
    if ("id" in by) return await find(ctx.db, "organization", by.id);
    const rows = await ctx.db
      .query("objects")
      .withIndex("object_external_id", (q) =>
        q.eq("object", "organization").eq("external_id", by.externalId),
      )
      .take(1);
    return only("organization", rows)[0] ?? null;
  },
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
