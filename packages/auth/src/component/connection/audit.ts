/**
 * `component.connection.audit.*` - Auth events scoped to a connection or group.
 *
 * @module
 */

import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";

import { vAuthEventProjectionDoc } from "../documents";
import { query } from "../_generated/server";
import { vPaginated } from "../model";
import schema from "../schema";

/**
 * List auth events scoped to a connection or a group, newest first and
 * paginated. Requires exactly one of `connectionId` or `groupId`, so a caller
 * cannot scan the whole event log by omitting the scope.
 */
export const list = query({
  args: {
    scope: v.union(
      v.object({ connectionId: schema.id("GroupConnection") }),
      v.object({ groupId: schema.id("Group") }),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: vPaginated(vAuthEventProjectionDoc),
  handler: async (ctx, { scope, paginationOpts }) => {
    if ("connectionId" in scope) {
      const result = await paginator(ctx.db, schema)
        .query("AuthEventProjection")
        .withIndex("target_time", (idx) =>
          idx.eq("targetKind", "connection").eq("targetId", scope.connectionId),
        )
        .order("desc")
        .paginate(paginationOpts);
      return result;
    }
    const result = await paginator(ctx.db, schema)
      .query("AuthEventProjection")
      .withIndex("target_time", (idx) =>
        idx.eq("targetKind", "group").eq("targetId", scope.groupId),
      )
      .order("desc")
      .paginate(paginationOpts);
    return result;
  },
});
