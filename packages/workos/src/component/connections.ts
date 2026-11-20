/**
 * Reads of WorkOS SSO connections, as the copy holds them.
 *
 * @module
 */
import { v } from "convex/values";
import { query } from "./_generated/server.ts";
import { find, owned } from "./copy.ts";
import { vConnection } from "./validators.ts";

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), vConnection),
  handler: async (ctx, args) => await find(ctx.db, "connection", args.id),
});

/** An organization's connections. An organization holds a handful. */
export const list = query({
  args: { organizationId: v.string() },
  returns: v.array(vConnection),
  handler: async (ctx, args) =>
    await owned(ctx.db, "connection", args.organizationId),
});
