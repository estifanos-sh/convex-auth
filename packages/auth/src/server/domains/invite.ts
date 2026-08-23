import type { Auth } from "convex/server";
import { ConvexError, type GenericId, type Value } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import type { ComponentCtx, ComponentReadCtx } from "../component/context";
import { configDefaults } from "../config";
import { getSessionUserId } from "../context";
import { generateRandomString, sha256 } from "../random";
import type { Doc, SortOrder } from "../types";

/** Convex-native `PaginationResult<T>` shape returned by the `*List` component queries. */
type Paginated<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};

export type InviteDeps = {
  config: ReturnType<typeof configDefaults>;
  inviteTokenAlphabet: string;
  inviteTokenLength: number;
  normalizeRoleIds: (roleIds?: string[]) => string[];
};

export function createInviteDomain(deps: InviteDeps) {
  const { config, inviteTokenAlphabet, inviteTokenLength, normalizeRoleIds } = deps;

  return {
    /**
     * Create a pending invite. Returns a one-time `token` the recipient
     * uses to accept. Optionally scoped to a group with role IDs.
     *
     * @param ctx - Convex mutation context.
     * @param opts.data.groupId - The group to invite the user to (optional).
     * @param opts.data.invitedByUserId - The user who created this invite (optional).
     * @param opts.data.email - The invitee's email address (optional).
     * @param opts.data.roleIds - Role IDs from `definePermissions()` to assign on acceptance (optional).
     * @param opts.data.expiresTime - Expiration timestamp in ms since epoch (optional).
     * @param opts.data.extend - Arbitrary app-specific metadata (optional).
     * @returns `{ id, token }`.
     * @throws `INVALID_ROLE_IDS` if any supplied role IDs are not defined.
     *
     * @example
     * ```ts
     * const { token } = await auth.invite.create(ctx, {
     *   data: { groupId, email: "alice@example.com", roleIds: [roles.member.id] },
     * });
     * ```
     */
    create: async (
      ctx: ComponentCtx,
      opts: {
        data: {
          groupId?: GenericId<"Group">;
          invitedByUserId?: GenericId<"User">;
          email?: string;
          roleIds?: string[];
          expiresTime?: number;
          extend?: { [key: string]: Value | undefined };
        };
      },
    ) => {
      const data = opts.data;
      const roleIds = normalizeRoleIds(data.roleIds);
      const token = generateRandomString(inviteTokenLength, inviteTokenAlphabet);
      const tokenHash = await sha256(token);
      const inviteId = (await ctx.runMutation(config.component.group.invite.create, {
        ...data,
        roleIds,
        tokenHash,
      })) as GenericId<"GroupInvite">;
      return { id: inviteId, token };
    },
    /**
     * Fetch an invite document by ID.
     *
     * Returns the full invite document including its status, email,
     * group, role IDs, and token hash. Useful for displaying invite
     * details or checking status before performing actions.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.id - The invite's document ID.
     * @returns The invite document, or `null` if not found.
     *
     * @example
     * ```ts
     * const invite = await auth.invite.get(ctx, { id: inviteId });
     * if (invite?.status === "pending") {
     *   // show invite details
     * }
     * ```
     */
    get: async (
      ctx: ComponentReadCtx,
      opts: { id: GenericId<"GroupInvite"> },
    ): Promise<Doc<"GroupInvite"> | null> => {
      return (await ctx.runQuery(config.component.group.invite.get, {
        id: opts.id,
      })) as Doc<"GroupInvite"> | null;
    },
    token: {
      /**
       * Look up an invite by its raw token string.
       *
       * Hashes the raw token and queries the database for a matching
       * invite. This is the standard path for invite-link landing pages
       * where the token is extracted from the URL.
       *
       * @param ctx - Convex query or mutation context.
       * @param opts.token - The raw invite token string from the invite link.
       * @returns The invite document, or `null` if no matching invite exists.
       *
       * @example
       * ```ts
       * const invite = await auth.invite.token.get(ctx, { token: tokenFromUrl });
       * if (!invite || invite.status !== "pending") {
       *   throw new Error("Invalid or expired invite");
       * }
       * ```
       */
      get: async (
        ctx: ComponentReadCtx,
        opts: { token: string },
      ): Promise<Doc<"GroupInvite"> | null> => {
        const tokenHash = await sha256(opts.token);
        return (await ctx.runQuery(config.component.group.invite.get, {
          tokenHash,
        })) as Doc<"GroupInvite"> | null;
      },
      /**
       * Accept an invite by token. Creates a membership and marks the invite as accepted.
       *
       * Hashes the raw token, finds the matching invite, creates a group
       * membership with the invite's role IDs, and transitions the invite
       * status to `"accepted"`.
       *
       * @param ctx - Convex mutation context.
       * @param args.token - The raw invite token string.
       * @returns The created membership details.
       *
       * @example
       * ```ts
       * const result = await auth.invite.token.accept(ctx, {
       *   token: tokenFromUrl,
       * });
       * ```
       */
      accept: async (
        ctx: ComponentCtx & { auth: Auth },
        args: { token: string },
      ): Promise<{
        inviteId: GenericId<"GroupInvite">;
        groupId: GenericId<"Group"> | null;
        memberId?: GenericId<"GroupMember">;
        inviteStatus: string;
        membershipStatus: string;
      }> => {
        const acceptedByUserId = await getSessionUserId(ctx);
        if (acceptedByUserId === null) {
          throw new ConvexError({
            code: ErrorCode.NOT_SIGNED_IN,
            message: "Authentication required.",
          });
        }
        const tokenHash = await sha256(args.token);
        const result = (await ctx.runMutation(config.component.group.invite.accept, {
          tokenHash,
          acceptedByUserId,
        })) as {
          inviteId: GenericId<"GroupInvite">;
          groupId: GenericId<"Group"> | null;
          memberId?: GenericId<"GroupMember">;
          inviteStatus: string;
          membershipStatus: string;
        };
        return { ...result };
      },
    },
    /**
     * List invites with optional filtering by group, status, email, etc.
     * Results are paginated.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.where - Filter criteria (all optional).
     * @param opts.where.status - `"pending"`, `"accepted"`, `"revoked"`, or `"expired"`.
     * @param opts.paginationOpts - Convex pagination options.
     * @param opts.orderBy - Sort field: `"_creationTime"`, `"status"`, `"email"`,
     *   `"expiresTime"`, or `"acceptedTime"`.
     * @param opts.order - Sort direction: `"asc"` or `"desc"`.
     * @returns Convex `PaginationResult` — `{ page, isDone, continueCursor }`.
     *
     * @example
     * ```ts
     * const { page } = await auth.invite.list(ctx, {
     *   where: { groupId, status: "pending" },
     *   paginationOpts: { numItems: 25, cursor: null },
     *   orderBy: "_creationTime",
     *   order: "desc",
     * });
     * ```
     */
    list: async (
      ctx: ComponentReadCtx,
      opts?: {
        where?: {
          tokenHash?: string;
          groupId?: GenericId<"Group">;
          status?: "pending" | "accepted" | "revoked" | "expired";
          email?: string;
          invitedByUserId?: GenericId<"User">;
          roleId?: string;
          acceptedByUserId?: GenericId<"User">;
        };
        paginationOpts: { numItems: number; cursor: string | null };
        orderBy?: "_creationTime" | "status" | "email" | "expiresTime" | "acceptedTime";
        order?: SortOrder;
      },
    ) => {
      return (await ctx.runQuery(config.component.group.invite.list, {
        where: opts?.where,
        paginationOpts: opts?.paginationOpts ?? { numItems: 50, cursor: null },
        orderBy: opts?.orderBy,
        order: opts?.order,
      })) as Paginated<Doc<"GroupInvite">>;
    },
    /**
     * Accept an invite by ID. Optionally specify who accepted it.
     *
     * Transitions the invite's status to `"accepted"` and optionally
     * records the accepting user. Unlike `invite.token.accept`, this
     * method does not automatically create a group membership — use it
     * for admin-driven invite acceptance flows.
     *
     * @param ctx - Convex mutation context.
     * @param opts.id - The invite's document ID.
     * @param opts.acceptedByUserId - The user who accepted the invite (optional).
     * @returns `{ id, acceptedByUserId }`.
     *
     * @example
     * ```ts
     * await auth.invite.accept(ctx, { id: inviteId, acceptedByUserId: userId });
     * ```
     */
    accept: async (
      ctx: ComponentCtx,
      opts: { id: GenericId<"GroupInvite">; acceptedByUserId?: GenericId<"User"> },
    ) => {
      const args = { id: opts.id };
      if (opts.acceptedByUserId !== undefined) {
        Object.assign(args, { acceptedByUserId: opts.acceptedByUserId });
      }
      await ctx.runMutation(config.component.group.invite.accept, args);
      return {
        id: opts.id,
        acceptedByUserId: opts.acceptedByUserId ?? null,
      };
    },
    /**
     * Revoke a pending invite. Sets its status to `"revoked"`.
     *
     * Once revoked, the invite's token can no longer be used to accept
     * the invitation. This is a permanent status change.
     *
     * @param ctx - Convex mutation context.
     * @param opts.id - The invite's document ID.
     * @returns `null`.
     *
     * @example
     * ```ts
     * await auth.invite.revoke(ctx, { id: inviteId });
     * ```
     */
    revoke: async (ctx: ComponentCtx, opts: { id: GenericId<"GroupInvite"> }) => {
      await ctx.runMutation(config.component.group.invite.revoke, { id: opts.id });
      return null;
    },
  };
}
