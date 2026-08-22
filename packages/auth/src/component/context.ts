/**
 * `component.context.get` — one consistent auth-state snapshot.
 *
 * @module
 */

import { v } from "convex/values";

import { query } from "./functions";
import { resolveActiveGroup, vActiveGroup } from "./group/active";
import { vSessionDoc, vUserDoc } from "./model";

const vAuthContextSnapshot = v.object({
  user: v.union(vUserDoc, v.null()),
  session: v.union(vSessionDoc, v.null()),
  active: v.union(vActiveGroup, v.null()),
});

/**
 * Read the current user, optional session, and active-group state in one
 * component transaction.
 *
 * The session is returned as the current durable row. Callers compare its
 * expiry and epoch with the already-verified JWT claim; this keeps session
 * revocation fresh without distributing authorization state into tokens.
 */
export const get = query({
  args: {
    userId: v.id("User"),
    sessionId: v.optional(v.id("Session")),
  },
  returns: vAuthContextSnapshot,
  handler: async (ctx, { userId, sessionId }) => {
    const user = await ctx.db.get("User", userId);
    if (user === null) {
      return { user: null, session: null, active: null };
    }

    const [session, active] = await Promise.all([
      sessionId === undefined ? null : ctx.db.get("Session", sessionId),
      resolveActiveGroup(ctx, userId, user),
    ]);
    return { user, session, active };
  },
});
