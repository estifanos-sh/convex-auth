import { ConvexError, type GenericId } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import type { ComponentCtx, ComponentReadCtx } from "../component/context";
import { configDefaults } from "../config";
import { cached, ctxCacheHas, invalidateCtxCache } from "../cache/context";
import type { Doc } from "../types";
import { capGrantsForCaller, resolveOAuthCaller } from "./access";

/** Convex-native `PaginationResult<T>` shape returned by the `*List` component queries. */
type Paginated<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};

type MemberDocLike = Doc<"GroupMember"> | null;

/** Options accepted by `member.list`. */
type MemberListOpts = {
  where?: { groupId?: GenericId<"Group">; userId?: GenericId<"User">; status?: string };
  paginationOpts: { numItems: number; cursor: string | null };
  orderBy?: "_creationTime" | "status";
  order?: "asc" | "desc";
};

type InspectResult = {
  membership: MemberDocLike;
  roleIds: string[];
  grants: string[];
};

type ResolveResult = InspectResult & {
  matchedGroupId: string | null;
  depth: number | null;
  isDirect: boolean;
  isInherited: boolean;
  traversedGroupIds: string[];
};

export type MemberDeps = {
  config: ReturnType<typeof configDefaults>;
  normalizeRoleIds: (roleIds?: string[]) => string[];
  resolveGrantedPermissions: (roleIds?: string[]) => string[];
};

export function createMemberDomain(deps: MemberDeps) {
  const { config, normalizeRoleIds, resolveGrantedPermissions } = deps;

  function memberInspect(
    ctx: ComponentReadCtx,
    opts: {
      userId: GenericId<"User">;
      groupId: GenericId<"Group">;
    },
  ): Promise<InspectResult>;
  function memberInspect(
    ctx: ComponentReadCtx,
    opts: { userId: GenericId<"User">; groupIds: readonly GenericId<"Group">[] },
  ): Promise<Array<InspectResult>>;
  async function memberInspect(
    ctx: ComponentReadCtx,
    opts:
      | {
          userId: GenericId<"User">;
          groupId: GenericId<"Group">;
        }
      | { userId: GenericId<"User">; groupIds: readonly GenericId<"Group">[] },
  ): Promise<InspectResult | Array<InspectResult>> {
    const oauthCaller = await resolveOAuthCaller(ctx);
    if ("groupIds" in opts) {
      const { userId, groupIds } = opts;
      if (groupIds.length === 0) return [];
      const unique = Array.from(new Set(groupIds));
      const toFetch: GenericId<"Group">[] = [];
      for (const groupId of unique) {
        if (!ctxCacheHas(ctx, `member-inspect:${userId}:${groupId}:n`)) {
          toFetch.push(groupId);
        }
      }
      if (toFetch.length > 0) {
        const docs = (await ctx.runQuery(config.component.group.member.get, {
          userId,
          groupIds: toFetch,
        })) as Array<MemberDocLike>;
        for (let i = 0; i < toFetch.length; i += 1) {
          const groupId = toFetch[i]!;
          const value = docs[i] ?? null;
          void cached(ctx, `member-inspect:${userId}:${groupId}:n`, () => Promise.resolve(value));
        }
      }
      return await Promise.all(
        groupIds.map(async (groupId) => {
          const membership = (await cached(ctx, `member-inspect:${userId}:${groupId}:n`, () =>
            ctx.runQuery(config.component.group.member.get, {
              userId,
              groupId,
            }),
          )) as MemberDocLike;
          if (membership === null) {
            return {
              membership: null,
              roleIds: [] as string[],
              grants: [] as string[],
            };
          }
          const membershipRoleIds = membership.roleIds ?? [];
          const membershipGrants = capGrantsForCaller(
            oauthCaller,
            userId,
            resolveGrantedPermissions(membershipRoleIds),
          );
          return {
            membership,
            roleIds: membershipRoleIds,
            grants: membershipGrants,
          };
        }),
      );
    }

    const cacheKey = `member-inspect:${opts.userId}:${opts.groupId}:n`;
    const membership = (await cached(ctx, cacheKey, () =>
      ctx.runQuery(config.component.group.member.get, {
        userId: opts.userId,
        groupId: opts.groupId,
      }),
    )) as MemberDocLike;

    if (membership === null) {
      return {
        membership: null,
        roleIds: [] as string[],
        grants: [] as string[],
      };
    }

    const membershipRoleIds = membership.roleIds ?? [];
    const membershipGrants = capGrantsForCaller(
      oauthCaller,
      opts.userId,
      resolveGrantedPermissions(membershipRoleIds),
    );

    return {
      membership,
      roleIds: membershipRoleIds,
      grants: membershipGrants,
    };
  }

  const member = {
    /**
     * Add a user to a group with optional role IDs.
     *
     * Role IDs are validated against the roles defined in `definePermissions()` —
     * invalid IDs throw `INVALID_ROLE_IDS`.
     * Throws `DUPLICATE_MEMBERSHIP` if the user is already a member.
     *
     * @param ctx - Convex mutation context.
     * @param opts.data.groupId - The group to add the user to.
     * @param opts.data.userId - The user's document ID.
     * @param opts.data.roleIds - Role IDs from `definePermissions()` (optional).
     * @param opts.data.status - Membership status string (optional, app-defined).
     * @param opts.data.extend - Arbitrary app-specific metadata.
     * @returns The created membership ID.
     * @throws `INVALID_ROLE_IDS` if any supplied role IDs are not defined.
     *
     * @example
     * ```ts
     * const memberId = await auth.member.create(ctx, {
     *   data: {
     *     groupId: orgId,
     *     userId,
     *     roleIds: [roles.orgAdmin.id],
     *   },
     * });
     * ```
     */
    create: async (
      ctx: ComponentCtx,
      opts: {
        data: {
          groupId: GenericId<"Group">;
          userId: GenericId<"User">;
          roleIds?: string[];
          status?: string;
          extend?: Record<string, unknown>;
        };
      },
    ) => {
      const data = opts.data;
      const roleIds = normalizeRoleIds(data.roleIds);
      const memberId = (await ctx.runMutation(config.component.group.member.create, {
        ...data,
        roleIds,
      })) as GenericId<"GroupMember">;
      invalidateCtxCache(ctx, `member-inspect:${data.userId}:${data.groupId}`);
      return memberId;
    },
    /**
     * List memberships with optional filtering and pagination.
     *
     * Supports filtering by `groupId`, `userId`, and `status`.
     * When `groupId` and `status` are both provided, a compound index
     * is used for efficient queries.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.where - Filter criteria (all optional).
     * @param opts.paginationOpts - Convex pagination options.
     * @param opts.orderBy - Sort field: `"_creationTime"` or `"status"`.
     * @param opts.order - Sort direction: `"asc"` or `"desc"`.
     * @returns Convex `PaginationResult` — `{ page, isDone, continueCursor }`.
     *
     * @example
     * ```ts
     * const { page } = await auth.member.list(ctx, {
     *   where: { groupId: orgId },
     *   paginationOpts: { numItems: 20, cursor: null },
     *   orderBy: "_creationTime",
     *   order: "asc",
     * });
     * ```
     */
    list: async (
      ctx: ComponentReadCtx,
      opts?: MemberListOpts,
    ): Promise<Paginated<Doc<"GroupMember">>> => {
      return (await ctx.runQuery(config.component.group.member.list, {
        where: opts?.where,
        paginationOpts: opts?.paginationOpts ?? { numItems: 50, cursor: null },
        orderBy: opts?.orderBy,
        order: opts?.order,
      })) as Paginated<Doc<"GroupMember">>;
    },
    /**
     * Remove a membership by its document ID.
     *
     * @param ctx - Convex mutation context.
     * @param opts.id - The membership document ID.
     * @returns `null`.
     *
     * @example
     * ```ts
     * await auth.member.remove(ctx, { id: memberId });
     * ```
     */
    remove: async (ctx: ComponentCtx, opts: { id: GenericId<"GroupMember"> }) => {
      await ctx.runMutation(config.component.group.member.remove, { id: opts.id });
      invalidateCtxCache(ctx, "member");
      invalidateCtxCache(ctx, "member-inspect");
      return null;
    },
    /**
     * Patch a membership's `roleIds`, `status`, or `extend` fields.
     * Role IDs are validated against `definePermissions()`.
     *
     * @param ctx - Convex mutation context.
     * @param opts.id - The membership document ID.
     * @param opts.patch - Fields to merge. `roleIds` are validated.
     * @returns `null`.
     * @throws `INVALID_ROLE_IDS` if any supplied role IDs are not defined.
     *
     * @example
     * ```ts
     * await auth.member.update(ctx, {
     *   id: memberId,
     *   patch: {
     *     roleIds: [roles.orgAdmin.id],
     *     status: "active",
     *   },
     * });
     * ```
     */
    update: async (
      ctx: ComponentCtx,
      opts: { id: GenericId<"GroupMember">; patch: Record<string, unknown> },
    ) => {
      const nextData = { ...opts.patch };
      if ("roleIds" in nextData) {
        nextData.roleIds = normalizeRoleIds(
          Array.isArray(nextData.roleIds) ? (nextData.roleIds as string[]) : undefined,
        );
      }
      await ctx.runMutation(config.component.group.member.update, {
        id: opts.id,
        patch: nextData,
      });
      invalidateCtxCache(ctx, `member:${opts.id}`);
      invalidateCtxCache(ctx, "member-inspect");
      return null;
    },
    /**
     * Read a user's direct membership and its resolved grants.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.userId - The user's document ID.
     * @param opts.groupId - The group to check membership in.
     * @returns `{ membership, roleIds, grants }`.
     *
     * @example Direct lookup
     * ```ts
     * const result = await auth.member.get(ctx, { userId, groupId });
     * if (!result.membership) return null;
     * ```
     *
     * @example Check grants after inspection
     * ```ts
     * const result = await auth.member.get(ctx, {
     *   userId, groupId,
     * });
     * const canCreate = result.grants.includes("issues.create");
     * ```
     *
     * @example Batched across many groups (one RPC)
     * ```ts
     * const resolutions = await auth.member.get(ctx, {
     *   userId, groupIds: rootGroupIds,
     * });
     * ```
     */
    get: memberInspect,
    /**
     * Resolve inherited membership explicitly by walking toward the root.
     *
     * Unlike {@link get}, this operation performs hierarchy traversal and
     * always reports the traversed groups and the location of the match.
     */
    resolve: async (
      ctx: ComponentReadCtx,
      opts: { userId: GenericId<"User">; groupId: GenericId<"Group">; maxDepth?: number },
    ): Promise<ResolveResult> => {
      const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? 32));
      const result = (await ctx.runQuery(config.component.group.member.resolve, {
        userId: opts.userId,
        groupId: opts.groupId,
        maxDepth,
      })) as Omit<ResolveResult, "roleIds" | "grants">;
      const roleIds = result.membership?.roleIds ?? [];
      const caller = await resolveOAuthCaller(ctx);
      return {
        ...result,
        roleIds,
        grants: capGrantsForCaller(caller, opts.userId, resolveGrantedPermissions(roleIds)),
      };
    },
    assert: async (
      ctx: ComponentReadCtx,
      opts: {
        userId: GenericId<"User">;
        groupId: GenericId<"Group">;
        roleIds?: string[];
        grants?: string[];
      },
    ) => {
      const validatedRoleIds = normalizeRoleIds(opts.roleIds);
      const requiredGrants = Array.from(new Set(opts.grants ?? []));
      const roleFilter = validatedRoleIds.length > 0 ? new Set(validatedRoleIds) : null;
      const result: InspectResult = await memberInspect(ctx, {
        userId: opts.userId,
        groupId: opts.groupId,
      });
      if (result.membership === null) {
        throw new ConvexError({
          code: ErrorCode.NOT_A_MEMBER,
          message: "User is not a member of this group.",
          groupId: opts.groupId,
        });
      }
      if (roleFilter !== null && !result.roleIds.some((roleId: string) => roleFilter.has(roleId))) {
        throw new ConvexError({
          code: ErrorCode.NOT_A_MEMBER,
          message: "User is not a member of this group.",
          groupId: opts.groupId,
        });
      }
      const missingGrants = requiredGrants.filter((grant) => !result.grants.includes(grant));
      if (missingGrants.length > 0) {
        throw new ConvexError({
          code: ErrorCode.MISSING_GRANTS,
          message: "User is missing required grants.",
          groupId: opts.groupId,
          missingGrants,
        });
      }
      return result;
    },
  };

  return member;
}
