import type { UserIdentity } from "convex/server";
import { ConvexError, type GenericId } from "convex/values";

import { ErrorCode } from "../shared/codes";
import type { ComponentReadCtx as AuthQueryCtx } from "./component/context";
import type { Doc } from "./types";
import {
  getAuthenticatedUserIdOrNull,
  getUserIdentityOrNull,
  oauthScopesFromIdentity,
  sessionIdFromIdentity,
  userIdFromIdentity,
} from "./identity/claims";

/** Canonical user document type exposed by Convex Auth. */
export type UserDoc = Doc<"User">;

type AuthIdentityCtx = {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
};

type AuthContextReadCtx = AuthIdentityCtx & AuthQueryCtx;

type AuthContextSnapshot = {
  user: Doc<"User"> | null;
  session: Doc<"Session"> | null;
  active: {
    groupId: string;
    group: Doc<"Group"> | null;
    membership: Doc<"GroupMember">;
    roleIds: string[];
    grants: string[];
  } | null;
};

/**
 * Current request auth context injected into `ctx.auth` by `auth.ctx()`. This
 * is the authenticated auth shape returned by {@link defineAuth().context}.
 * Optional context builders may still surface nullable fields when
 * `optional: true` is used.
 *
 * - `groupId` is `null` when the user has no active group set.
 * - `role` is `null` when no active group or no membership is resolved.
 * - `grants` is `[]` when no active group or no membership is resolved.
 *
 * @example
 * ```ts
 * import type { AuthContext } from "@estifanos-sh/convex-auth/server";
 *
 * const mockAuth: AuthContext = {
 *   userId: "user123" as Id<"User">,
 *   user: { _id: "user123", email: "test@example.com" },
 *   groupId: "group456",
 *   role: "admin",
 *   grants: ["read", "write"],
 * };
 * ```
 */
export type AuthContext = {
  /** The authenticated user's document ID. */
  userId: GenericId<"User">;
  /** The authenticated user's full document. */
  user: UserDoc;
  /** The user's active group ID, or `null` if none set. */
  groupId: GenericId<"Group"> | null;
  /** The user's primary role in the active group, or `null`. */
  role: string | null;
  /** Resolved grant strings from the user's role definitions. */
  grants: string[];
  /**
   * Assert the current user holds the given grant(s); throws
   * `ConvexError({ code: ErrorCode.MISSING_GRANTS })` otherwise. Pass a
   * group-owned document as the second argument to also assert the
   * record belongs to the active group (`code: ErrorCode.FORBIDDEN` if not).
   *
   * For a boolean check, read `grants` directly:
   * `ctx.auth.grants.includes("issues.read")`.
   *
   * @example
   * ```ts
   * ctx.auth.assert("members.manage");
   * ctx.auth.assert(["issues.edit", "issues.move"]);
   * ctx.auth.assert("issues.edit", issueDoc); // group-scoped
   * ```
   */
  assert: (grant: string | readonly string[], doc?: { groupId?: unknown }) => void;
};

/**
 * Nullable auth context returned by `auth.context.optional(ctx)` and injected
 * by `auth.ctx.optional()`.
 *
 * Use this when callers may be unauthenticated but you still want a stable
 * auth-shaped object.
 *
 * - `userId` and `user` are `null` when unauthenticated.
 * - `groupId` and `role` are `null` when no active group is resolved.
 * - `grants` is `[]` when no membership is resolved.
 *
 * @example
 * ```ts
 * const authContext = await auth.context.optional(ctx);
 * if (authContext.userId === null) {
 *   return null;
 * }
 * ```
 */
export type OptionalAuthContext = {
  /** The authenticated user's document ID, or `null` when unauthenticated. */
  userId: GenericId<"User"> | null;
  /** The authenticated user's full document, or `null` when unauthenticated. */
  user: UserDoc | null;
  /** The user's active group ID, or `null` if none is set. */
  groupId: GenericId<"Group"> | null;
  /** The user's primary role in the active group, or `null`. */
  role: string | null;
  /** Resolved grant strings for the active membership, or `[]`. */
  grants: string[];
  /**
   * Assert the current user holds the given grant(s); throws when
   * missing (or, with a group-owned `doc`, when it is not in the active
   * group). When unauthenticated this always throws. For a boolean
   * check read `grants` directly.
   */
  assert: (grant: string | readonly string[], doc?: { groupId?: unknown }) => void;
};

/**
 * Minimal auth helper surface required by the context resolvers.
 *
 * @internal
 */
export type AuthLike = {
  context: {
    get: (
      ctx: AuthContextReadCtx,
      args: { userId: string; sessionId?: string },
    ) => Promise<AuthContextSnapshot>;
  };
};

/**
 * Configuration for {@link defineAuth().ctx} context enrichment.
 *
 * The same config shape is also used by {@link defineAuth().context}.
 *
 * @typeParam TResolve - Extra fields returned from `resolve()` and merged into
 *   the resulting `ctx.auth` object.
 *
 * @example
 * ```ts
 * const authContext = await auth.context(ctx, {
 *   resolve: async (_ctx, user, authState) => ({
 *     email: user.email,
 *     canWrite: authState.grants.includes("posts.write"),
 *   }),
 * });
 * ```
 */
export type AuthContextConfig<
  TResolve extends object = Record<string, never>,
  TCtx extends AuthIdentityCtx = AuthIdentityCtx,
> = {
  /**
   * Enforce grant(s) inline — equivalent to calling `ctx.auth.assert(...)`
   * at the top of every handler built with this customization. Throws
   * `ConvexError({ code: ErrorCode.MISSING_GRANTS })` when missing.
   */
  assert?: string | readonly string[];
  /**
   * Require an active group; throws `ConvexError({ code: ErrorCode.NO_ACTIVE_GROUP })`
   * when the resolved context has no `groupId`. Reuses the `active` concept.
   */
  active?: true;
  /**
   * Attach additional derived fields to the auth context after the base auth
   * context is resolved.
   *
   * This callback runs only when an authenticated user context is available.
   */
  resolve?: (ctx: TCtx, user: UserDoc, auth: AuthContext) => Promise<TResolve> | TResolve;
};

/** @internal */
export async function getSessionUserId(ctx: AuthIdentityCtx): Promise<GenericId<"User"> | null> {
  // Convex identities carry component document IDs as strings. This is the
  // single identity-to-component boundary; public auth helpers retain the
  // table-specific ID type from here onward.
  return (await getAuthenticatedUserIdOrNull(ctx)) as GenericId<"User"> | null;
}

/**
 * Build the `ctx.auth.assert` grant guard from the resolved grants and
 * active group. `assert(grant)` throws when a grant is missing;
 * `assert(grant, doc)` additionally asserts the group-owned `doc` belongs
 * to the active group. Reuses `member.assert`'s `MISSING_GRANTS` code.
 *
 * @internal
 */
function makeAssert(groupId: string | null, grants: readonly string[]): AuthContext["assert"] {
  return (grant, doc) => {
    const needed = Array.isArray(grant) ? grant : [grant as string];
    const missing = needed.filter((g) => !grants.includes(g));
    if (missing.length > 0) {
      throw new ConvexError({
        code: ErrorCode.MISSING_GRANTS,
        message: "User is missing required grants.",
      });
    }
    if (doc !== undefined) {
      const docGroupId = (doc as { groupId?: unknown }).groupId;
      if (groupId === null || String(docGroupId) !== groupId) {
        throw new ConvexError({
          code: ErrorCode.FORBIDDEN,
          message: "Record is not in the active group.",
        });
      }
    }
  };
}

/**
 * Resolve the caller's *effective* active group and its grants on the hot path.
 *
 * The active-group domain resolves the stored preference, membership fallback,
 * and grants through one component transaction.
 *
 * @internal
 */
function authContextFromSnapshot(
  userId: string,
  snapshot: AuthContextSnapshot,
  oauthScopes?: readonly string[],
): AuthContext {
  const { user, active } = snapshot;
  if (user === null) {
    throw new ConvexError({
      code: ErrorCode.NOT_SIGNED_IN,
      message: "The authenticated user no longer exists.",
    });
  }
  const groupId = (active?.groupId as GenericId<"Group"> | undefined) ?? null;
  const role = active?.roleIds[0] ?? null;
  const grants = active?.grants ?? [];
  const effectiveGrants =
    oauthScopes === undefined ? grants : grants.filter((grant) => oauthScopes.includes(grant));
  return {
    userId: userId as AuthContext["userId"],
    user,
    groupId,
    role,
    grants: effectiveGrants,
    assert: makeAssert(groupId, effectiveGrants),
  };
}

/**
 * @internal
 *
 * Resolve the caller's auth context. When `oauthScopes` is supplied (the request
 * is authenticated by a scoped OAuth access token rather than a full session),
 * the user's role grants are intersected with the token's scopes so the caller's
 * effective grants — and therefore `assert` — can never exceed the granted
 * scope. Scopes and grants share one vocabulary, so this is a set intersection.
 * A session caller passes no scopes and keeps their full role grants.
 */
export async function getAuthContextForUser(
  auth: AuthLike,
  ctx: AuthContextReadCtx,
  userId: string,
  oauthScopes?: readonly string[],
): Promise<AuthContext> {
  const snapshot = await auth.context.get(ctx, { userId });
  return authContextFromSnapshot(userId, snapshot, oauthScopes);
}

/** @internal */
export async function getAuthContext(
  auth: AuthLike,
  ctx: AuthIdentityCtx & AuthQueryCtx,
): Promise<AuthContext | null> {
  const identity = await getUserIdentityOrNull(ctx);
  if (identity === null) {
    return null;
  }
  const userId = userIdFromIdentity(identity);
  const oauthScopes = oauthScopesFromIdentity(identity);
  if (oauthScopes !== null) {
    return await getAuthContextForUser(auth, ctx, userId, oauthScopes);
  }

  let sessionId;
  try {
    sessionId = sessionIdFromIdentity(identity);
  } catch {
    return null;
  }
  const snapshot = await auth.context.get(ctx, { userId, sessionId });
  const { session, user } = snapshot;
  if (
    session === null ||
    user === null ||
    session.userId !== userId ||
    session.expirationTime <= Date.now() ||
    session.epoch !== user.sessionEpoch ||
    identity.session_epoch !== session.epoch
  ) {
    return null;
  }
  return authContextFromSnapshot(userId, snapshot);
}

/** @internal */
export function createUnauthenticatedAuthContext(): OptionalAuthContext {
  return {
    userId: null,
    user: null,
    groupId: null,
    role: null,
    grants: [],
    assert: makeAssert(null, []),
  };
}
