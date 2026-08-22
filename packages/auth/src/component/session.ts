/**
 * `component.session.*` — auth sessions.
 *
 * @module
 */

import { type Infer, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { vSessionDoc, vUserDoc } from "./documents";

/** Maximum number of current sessions retained for one user. */
export const MAX_ACTIVE_SESSIONS = 16;

/** Bounded physical cleanup after a logically complete revocation. */
const SESSION_CLEANUP_BATCH = MAX_ACTIVE_SESSIONS;

/** Bounded refresh-token cleanup for one removed session. */
const SESSION_TOKEN_DELETE_BATCH = 1024;

type CreateSessionArgs = {
  userId: Id<"User">;
  sessionId?: Id<"Session">;
  replaceSession?: SessionReplacement;
  sessionExpirationTime: number;
  refreshTokenExpirationTime?: number;
};

/** A current authenticated session that may be replaced during sign-in. */
export type SessionReplacement = {
  sessionId: Id<"Session">;
  authenticatedUserId: Id<"User">;
};

/** Validator for a replacement that proves ownership of the old session. */
export const vSessionReplacement = v.object({
  sessionId: v.id("Session"),
  authenticatedUserId: v.id("User"),
});

export type SessionRows = {
  user: Infer<typeof vUserDoc>;
  sessionId: Id<"Session">;
  sessionExpirationTime: number;
  epoch: number;
  refreshTokenId?: Id<"RefreshToken">;
  replacedSessionId?: Id<"Session">;
};

async function deleteSessionArtifacts(ctx: MutationCtx, sessionId: Id<"Session">) {
  const tokens = await ctx.db
    .query("RefreshToken")
    .withIndex("session_id", (q) => q.eq("sessionId", sessionId))
    .take(SESSION_TOKEN_DELETE_BATCH);
  await Promise.all(tokens.map((token) => ctx.db.delete("RefreshToken", token._id)));
  await ctx.db.delete("Session", sessionId);
  return tokens.length;
}

type SessionRevocation = {
  epoch: number;
  retainedSessionIds: Id<"Session">[];
  cleanedSessionIds: Id<"Session">[];
  cleanedSessions: number;
  cleanedRefreshTokens: number;
  cleanupPending: boolean;
};

/**
 * Advance the user's session epoch, making every prior token unusable in the
 * same transaction. Physical row deletion is intentionally bounded: rows left
 * behind cannot authenticate or refresh because their epoch is stale.
 */
async function revokeUserSessions(
  ctx: MutationCtx,
  userId: Id<"User">,
  except: readonly Id<"Session">[] = [],
): Promise<SessionRevocation> {
  const now = Date.now();
  const user = await ctx.db.get("User", userId);
  if (user === null) {
    return {
      epoch: 0,
      retainedSessionIds: [],
      cleanedSessionIds: [],
      cleanedSessions: 0,
      cleanedRefreshTokens: 0,
      cleanupPending: false,
    };
  }

  const epoch = user.sessionEpoch + 1;
  await ctx.db.patch("User", userId, { sessionEpoch: epoch });

  const retainedSessionIds: Id<"Session">[] = [];
  for (const sessionId of new Set(except)) {
    const session = await ctx.db.get("Session", sessionId);
    if (session !== null && session.userId === userId && session.expirationTime > now) {
      await ctx.db.patch("Session", sessionId, { epoch });
      retainedSessionIds.push(sessionId);
    }
  }

  const candidates = await ctx.db
    .query("Session")
    .withIndex("user_id", (q) => q.eq("userId", userId))
    .take(SESSION_CLEANUP_BATCH + 1);
  const stale = candidates
    .filter((session) => !retainedSessionIds.includes(session._id))
    .slice(0, SESSION_CLEANUP_BATCH);
  let cleanedRefreshTokens = 0;
  for (const session of stale) {
    cleanedRefreshTokens += await deleteSessionArtifacts(ctx, session._id);
  }
  return {
    epoch,
    retainedSessionIds,
    cleanedSessionIds: stale.map((session) => session._id),
    cleanedSessions: stale.length,
    cleanedRefreshTokens,
    // This is deliberately conservative. A `true` value means callers must
    // not infer that every inert row was physically removed.
    cleanupPending: candidates.length > SESSION_CLEANUP_BATCH,
  };
}

/**
 * Create or rotate session rows inside an existing component mutation.
 *
 * Keeping the database work in a plain helper lets factor-specific completion
 * mutations commit their anti-replay state and the new session atomically,
 * without nesting another `ctx.runMutation` transaction.
 *
 * @internal
 */
export async function createSessionRows(ctx: MutationCtx, args: CreateSessionArgs) {
  const now = Date.now();
  const user = await ctx.db.get("User", args.userId);
  if (user === null) return null;
  const epoch = user.sessionEpoch;

  let sessionId = args.sessionId;
  let resolvedSessionExpirationTime: number;
  const replacement = args.replaceSession;
  let replacedSessionId = replacement?.sessionId;

  if (sessionId === undefined) {
    if (replacement !== undefined) {
      const existingSession = await ctx.db.get("Session", replacement.sessionId);
      const authenticatedUser = await ctx.db.get("User", replacement.authenticatedUserId);
      if (
        existingSession !== null &&
        authenticatedUser !== null &&
        existingSession.userId === authenticatedUser._id &&
        existingSession.expirationTime > now &&
        existingSession.epoch === authenticatedUser.sessionEpoch
      ) {
        await deleteSessionArtifacts(ctx, replacement.sessionId);
      } else {
        replacedSessionId = undefined;
      }
    } else {
      const active = await ctx.db
        .query("Session")
        .withIndex("user_id_epoch_expiration_time", (q) =>
          q.eq("userId", user._id).eq("epoch", epoch).gt("expirationTime", now),
        )
        .take(MAX_ACTIVE_SESSIONS);
      if (active.length === MAX_ACTIVE_SESSIONS) {
        await deleteSessionArtifacts(ctx, active[0]._id);
      }
    }

    sessionId = await ctx.db.insert("Session", {
      userId: user._id,
      expirationTime: args.sessionExpirationTime,
      epoch,
    });
    resolvedSessionExpirationTime = args.sessionExpirationTime;
  } else {
    const existingSession = await ctx.db.get("Session", sessionId);
    if (
      existingSession === null ||
      existingSession.userId !== user._id ||
      existingSession.expirationTime <= now ||
      existingSession.epoch !== epoch
    ) {
      return null;
    }
    resolvedSessionExpirationTime = existingSession.expirationTime;
  }

  const refreshTokenId =
    args.refreshTokenExpirationTime === undefined
      ? undefined
      : await ctx.db.insert("RefreshToken", {
          sessionId,
          expirationTime: args.refreshTokenExpirationTime,
        });

  const rows: SessionRows = {
    user,
    sessionId,
    sessionExpirationTime: resolvedSessionExpirationTime,
    epoch,
  };
  if (refreshTokenId !== undefined) rows.refreshTokenId = refreshTokenId;
  if (replacedSessionId !== undefined) rows.replacedSessionId = replacedSessionId;
  return rows;
}

/** Read a session by id. */
export const get = query({
  args: { id: v.id("Session") },
  returns: v.union(vSessionDoc, v.null()),
  handler: async (ctx, { id: sessionId }) => {
    return await ctx.db.get("Session", sessionId);
  },
});

/**
 * List at most {@link MAX_ACTIVE_SESSIONS} newest sessions from the user's
 * current revocation epoch. Results include `expirationTime`; callers compare
 * it with their own clock so this reactive query never depends on wall time.
 */
export const list = query({
  args: { userId: v.id("User") },
  returns: v.array(vSessionDoc),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("User", userId);
    if (user === null) return [];
    return await ctx.db
      .query("Session")
      .withIndex("user_id_epoch_expiration_time", (q) =>
        q.eq("userId", userId).eq("epoch", user.sessionEpoch),
      )
      .order("desc")
      .take(MAX_ACTIVE_SESSIONS);
  },
});

/**
 * Create (or rotate) a session together with its first refresh token.
 * Returns the resolved `{ userId, sessionId, refreshTokenId }` — a command
 * summary rather than `v.null()` — because callers need the freshly minted
 * ids to mint tokens and set cookies. `replaceSession` carries the current
 * authenticated user alongside the session id, so the old session can be
 * deleted only after its ownership is proven in this transaction. When that
 * session was present and deleted, its id is echoed back as `replacedSessionId` so the
 * caller can emit a `session.invalidated` audit event for the terminated
 * session.
 */
export const create = mutation({
  args: {
    userId: v.id("User"),
    sessionId: v.optional(v.id("Session")),
    replaceSession: v.optional(vSessionReplacement),
    sessionExpirationTime: v.number(),
    refreshTokenExpirationTime: v.optional(v.number()),
  },
  returns: v.object({
    userId: v.id("User"),
    sessionId: v.id("Session"),
    sessionExpirationTime: v.number(),
    refreshTokenId: v.optional(v.id("RefreshToken")),
    replacedSessionId: v.optional(v.id("Session")),
    epoch: v.number(),
    user: vUserDoc,
  }),
  handler: async (ctx, args) => {
    const created = await createSessionRows(ctx, args);
    if (created === null) {
      throw new Error(`Cannot create or reuse a session for user ${args.userId}`);
    }

    return {
      userId: args.userId,
      ...created,
    };
  },
});

/** Delete a session (no-op if it no longer exists). */
const remove = mutation({
  args: { id: v.id("Session") },
  returns: v.null(),
  handler: async (ctx, { id: sessionId }) => {
    if ((await ctx.db.get("Session", sessionId)) !== null) {
      await ctx.db.delete("Session", sessionId);
    }
    return null;
  },
});

export { remove };

/** @internal */
export async function revokeSessionState(ctx: MutationCtx, userId: Id<"User">) {
  return await revokeUserSessions(ctx, userId);
}

/** @internal */
export async function revokeSessionRows(ctx: MutationCtx, userId: Id<"User">) {
  return (await revokeSessionState(ctx, userId)).cleanedSessions;
}

/**
 * Revoke every session a user owns. The epoch advance is the complete,
 * atomic revocation boundary. Cleanup removes only a bounded number of now
 * inert session and refresh-token rows; `cleanupPending` reports when more
 * physical cleanup may remain.
 */
export const revokeForUser = mutation({
  args: { userId: v.id("User"), except: v.optional(v.array(v.id("Session"))) },
  returns: v.object({
    epoch: v.number(),
    retainedSessionIds: v.array(v.id("Session")),
    cleanedSessionIds: v.array(v.id("Session")),
    cleanedSessions: v.number(),
    cleanedRefreshTokens: v.number(),
    cleanupPending: v.boolean(),
  }),
  handler: async (ctx, { userId, except }) => {
    return await revokeUserSessions(ctx, userId, except ?? []);
  },
});
