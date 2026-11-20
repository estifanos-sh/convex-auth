/**
 * Reads of WorkOS directories, as the copy holds them.
 *
 * @module
 */
import { v } from "convex/values";
import { query } from "./_generated/server.ts";
import { find, owned } from "./copy.ts";
import { vDirectory } from "./validators.ts";

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), vDirectory),
  handler: async (ctx, args) => await find(ctx.db, "directory", args.id),
});

/** An organization's directories. An organization holds a handful. */
export const list = query({
  args: { organizationId: v.string() },
  returns: v.array(vDirectory),
  handler: async (ctx, args) =>
    await owned(ctx.db, "directory", args.organizationId),
});
