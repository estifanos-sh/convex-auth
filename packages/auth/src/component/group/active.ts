/**
 * `component.group.active.*` — transactional active-group preference.
 *
 * @module
 */

import { ConvexError, v } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { mutation, query } from "../_generated/server";
import { vGroupDoc, vGroupMemberDoc } from "../documents";

export const vActiveGroup = v.object({
  groupId: v.id("Group"),
  group: v.union(vGroupDoc, v.null()),
  membership: vGroupMemberDoc,
});

/**
 * Resolve an active membership from an already-read user when available.
 *
 * The context resolver uses this in its single component query so resolving a
 * session never reads `User` again just to inspect `lastActiveGroup`.
 *
 * @internal
 */
export async function resolveActiveGroup(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"User">,
  user: { lastActiveGroup?: Id<"Group"> } | null,
) {
  if (user === null) return null;

  const preferred =
    user.lastActiveGroup === undefined
      ? null
      : await ctx.db
          .query("GroupMember")
          .withIndex("group_id_user_id", (q) =>
            q.eq("groupId", user.lastActiveGroup!).eq("userId", userId),
          )
          .unique();
  const membership =
    preferred ??
    (await ctx.db
      .query("GroupMember")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .first());
  if (membership === null) return null;
  const group = await ctx.db.get("Group", membership.groupId);
  return { groupId: membership.groupId, group, membership };
}

/** Resolve the stored preference, falling back deterministically to the first membership. */
export const get = query({
  args: { userId: v.id("User") },
  returns: v.union(vActiveGroup, v.null()),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("User", userId);
    return await resolveActiveGroup(ctx, userId, user);
  },
});

/** Validate membership and persist the preferred active group atomically. */
export const update = mutation({
  args: { userId: v.id("User"), groupId: v.id("Group") },
  returns: v.null(),
  handler: async (ctx, { userId, groupId }) => {
    const membership = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (q) => q.eq("groupId", groupId).eq("userId", userId))
      .unique();
    if (membership === null) {
      throw new ConvexError({
        code: ErrorCode.NOT_A_MEMBER,
        message: "User is not a member of this group.",
        groupId,
      });
    }
    await ctx.db.patch("User", userId, { lastActiveGroup: groupId });
    return null;
  },
});

/** Clear the preference so the next read falls back to the first membership. */
export const reset = mutation({
  args: { userId: v.id("User") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("User", userId);
    if (user !== null) await ctx.db.patch("User", userId, { lastActiveGroup: undefined });
    return null;
  },
});
