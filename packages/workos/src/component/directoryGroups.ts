/**
 * Reads of WorkOS directory groups, as the copy holds them.
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
import { vDirectoryGroup } from "./validators.ts";

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), vDirectoryGroup),
  handler: async (ctx, args) => await find(ctx.db, "directory_group", args.id),
});

/** Directory groups, filtered by one of `directory` and `organization`. */
export const list = query({
  args: {
    filter: v.union(
      v.object({ directory: v.string() }),
      v.object({ organization: v.string() }),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(vDirectoryGroup),
  handler: async (ctx, { filter, paginationOpts: { numItems, cursor } }) => {
    const objects = ctx.db.query("objects");
    const rows =
      "directory" in filter
        ? objects.withIndex("object_directory_id_id", (q) => {
            const groups = q
              .eq("object", "directory_group")
              .eq("directory_id", filter.directory);
            return cursor === null ? groups : groups.gt("id", cursor);
          })
        : objects.withIndex("object_organization_id_id", (q) => {
            const groups = q
              .eq("object", "directory_group")
              .eq("organization_id", filter.organization);
            return cursor === null ? groups : groups.gt("id", cursor);
          });
    return await pageOf("directory_group", rows, numItems);
  },
});
