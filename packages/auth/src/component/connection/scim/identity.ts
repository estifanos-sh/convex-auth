/**
 * `component.connection.scim.identity.*` — SCIM-provisioned
 * identities for an Connection connection (sub-resource of connection).
 *
 * `get` is overloaded — single lookup or, with `{ connectionId,
 * userIds }`, a batched resolve aligned to input order.
 *
 * @module
 */

import { paginationOptsValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";

import { ErrorCode } from "../../../shared/codes";
import { convexError } from "../../../shared/errors";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { assertBatchSelectorSize } from "../../batch";
import { mutation, query } from "../../_generated/server";
import { vGroupConnectionScimIdentityDoc } from "../../documents";
import {
  vGroupConnectionDeprovisionMode,
  vGroupConnectionProfileUpdateMode,
  vPaginated,
  vScimResourceType,
} from "../../model";
import schema from "../../schema";
import { revokeSessionState } from "../../session";

const vScimUserData = schema.tables.User.validator.omit("sessionEpoch");

/**
 * Load the SCIM identity row for `userId` on this connection, asserting it is
 * a user resource owned by this connection's group and that no *other* SCIM
 * connection already manages the same user.
 *
 * `update` and `revoke` both gate on exactly this. It is a tenancy boundary —
 * two copies is two chances for one of them to stop checking the group.
 */
async function requireScimUserIdentity(
  ctx: QueryCtx,
  args: { connectionId: Id<"GroupConnection">; userId: Id<"User">; groupId: string },
) {
  const identity = await ctx.db
    .query("GroupConnectionScimIdentity")
    .withIndex("group_connection_id_user_id", (idx) =>
      idx.eq("connectionId", args.connectionId).eq("userId", args.userId),
    )
    .unique();
  if (identity === null || identity.resourceType !== "user" || identity.groupId !== args.groupId)
    throw convexError(ErrorCode.ACCOUNT_NOT_FOUND, "SCIM user not found.");
  const conflictingIdentity = await ctx.db
    .query("GroupConnectionScimIdentity")
    .withIndex("user_id", (idx) => idx.eq("userId", args.userId))
    .filter((query) => query.neq(query.field("connectionId"), args.connectionId))
    .first();
  if (conflictingIdentity !== null) {
    throw convexError(
      ErrorCode.ACCOUNT_ALREADY_LINKED,
      "User is managed by another SCIM connection.",
    );
  }
  return identity;
}

/**
 * Resolve the `Account` row a SCIM `externalId` maps to for this connection's
 * synthetic provider, or `null` when there is no external id to look up.
 */
function scimAccountByExternalId(ctx: QueryCtx, provider: string, externalId: string | undefined) {
  if (externalId === undefined) return Promise.resolve(null);
  return ctx.db
    .query("Account")
    .withIndex("provider_account_id", (idx) =>
      idx.eq("provider", provider).eq("providerAccountId", externalId),
    )
    .unique();
}

/** Maximum memberships changed by one SCIM group mutation. */
const SCIM_GROUP_MEMBERSHIP_BATCH_SIZE = 100;

const vScimMembershipProgress = v.object({
  isDone: v.boolean(),
  continueCursor: v.string(),
});

function assertScimMembershipBatchSize(memberIds: Array<Id<"User">>) {
  if (memberIds.length > SCIM_GROUP_MEMBERSHIP_BATCH_SIZE) {
    throw convexError(
      ErrorCode.INVALID_PARAMETERS,
      `SCIM group membership batches are limited to ${SCIM_GROUP_MEMBERSHIP_BATCH_SIZE} members.`,
    );
  }
}

type ScimUserData = Infer<typeof vScimUserData>;
type ProfileUpdate = Infer<typeof vGroupConnectionProfileUpdateMode>;

type ScimUserIdentity = Pick<
  Infer<typeof vGroupConnectionScimIdentityDoc>,
  "connectionId" | "groupId" | "externalId" | "lastProvisionedAt" | "active" | "raw"
> & {
  resourceType: "user";
  userId: NonNullable<Infer<typeof vGroupConnectionScimIdentityDoc>["userId"]>;
};

/**
 * Read SCIM identities, overloaded by the args supplied. With
 * `{ connectionId, userIds }` it batch-resolves and returns an array aligned to
 * the input order (`null` per missing user; max 100 IDs). Otherwise it resolves a single
 * identity by `(connectionId, resourceType, externalId)`, `(connectionId,
 * userId)`, `userId`, or `mappedGroupId`. Returns `null` when nothing matches.
 */
export const get = query({
  args: {
    connectionId: v.optional(v.id("GroupConnection")),
    resourceType: v.optional(vScimResourceType),
    externalId: v.optional(v.string()),
    userId: v.optional(v.id("User")),
    userIds: v.optional(v.array(v.id("User"))),
    mappedGroupId: v.optional(v.id("Group")),
  },
  returns: v.union(
    vGroupConnectionScimIdentityDoc,
    v.null(),
    v.array(v.union(vGroupConnectionScimIdentityDoc, v.null())),
  ),
  handler: async (ctx, args) => {
    if (args.connectionId !== undefined && args.userIds !== undefined) {
      const userIds = args.userIds;
      assertBatchSelectorSize(userIds, "userIds");
      if (userIds.length === 0) return [];
      const unique = Array.from(new Set(userIds));
      const docs = await Promise.all(
        unique.map((userId) =>
          ctx.db
            .query("GroupConnectionScimIdentity")
            .withIndex("group_connection_id_user_id", (idx) =>
              idx.eq("connectionId", args.connectionId!).eq("userId", userId),
            )
            .first(),
        ),
      );
      const byUserId = new Map(unique.map((id, i) => [id, docs[i] ?? null]));
      return userIds.map((userId) => byUserId.get(userId) ?? null);
    }
    if (
      args.connectionId !== undefined &&
      args.resourceType !== undefined &&
      args.externalId !== undefined
    ) {
      return await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("group_connection_id_resource_type_external_id", (idx) =>
          idx
            .eq("connectionId", args.connectionId!)
            .eq("resourceType", args.resourceType!)
            .eq("externalId", args.externalId!),
        )
        .first();
    }
    if (args.connectionId !== undefined && args.userId !== undefined) {
      return await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("group_connection_id_user_id", (idx) =>
          idx.eq("connectionId", args.connectionId!).eq("userId", args.userId!),
        )
        .first();
    }
    if (args.userId !== undefined) {
      return await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("user_id", (idx) => idx.eq("userId", args.userId!))
        .first();
    }
    if (args.mappedGroupId !== undefined) {
      return await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("mapped_group_id", (idx) => idx.eq("mappedGroupId", args.mappedGroupId!))
        .first();
    }
    return null;
  },
});

/** List a connection's SCIM identities, paginated. */
export const list = query({
  args: {
    connectionId: v.id("GroupConnection"),
    paginationOpts: paginationOptsValidator,
  },
  returns: vPaginated(vGroupConnectionScimIdentityDoc),
  handler: async (ctx, { connectionId, paginationOpts }) => {
    return await paginator(ctx.db, schema)
      .query("GroupConnectionScimIdentity")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", connectionId))
      .paginate(paginationOpts);
  },
});

function providerForConnection(connection: { _id: string; protocol: string }) {
  if (connection.protocol === "oidc") return `oidc:${connection._id}`;
  if (connection.protocol === "saml") return `saml:${connection._id}`;
  throw convexError(ErrorCode.PROVIDER_NOT_CONFIGURED, "SCIM requires an OIDC or SAML connection.");
}

function patchProfile(current: Record<string, unknown>, next: ScimUserData, mode: ProfileUpdate) {
  if (mode === "never") return {};
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) =>
      value === undefined
        ? false
        : mode === "always" ||
          current[key] === undefined ||
          current[key] === null ||
          current[key] === "",
    ),
  );
}

/**
 * Atomically provision a directory-managed user, account, SCIM identity, and
 * membership. Group and provider ownership are derived from the connection.
 */
export const provision = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    externalId: v.optional(v.string()),
    userData: vScimUserData,
    profileUpdate: vGroupConnectionProfileUpdateMode,
    roleIds: v.array(v.string()),
    lastProvisionedAt: v.optional(v.number()),
    active: v.optional(v.boolean()),
    raw: v.optional(v.any()),
  },
  returns: v.object({ userId: v.id("User"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    const provider = providerForConnection(connection);
    const externalId = args.externalId;
    const identity =
      externalId === undefined
        ? null
        : await ctx.db
            .query("GroupConnectionScimIdentity")
            .withIndex("group_connection_id_resource_type_external_id", (idx) =>
              idx
                .eq("connectionId", args.connectionId)
                .eq("resourceType", "user")
                .eq("externalId", externalId),
            )
            .unique();
    const account = await scimAccountByExternalId(ctx, provider, externalId);
    if (identity?.userId !== undefined && account !== null && identity.userId !== account.userId) {
      throw convexError(ErrorCode.ACCOUNT_ALREADY_LINKED, "SCIM account ownership conflicts.");
    }
    let userId = identity?.userId ?? account?.userId;
    let created = false;
    if (userId === undefined) {
      userId = await ctx.db.insert("User", {
        ...args.userData,
        sessionEpoch: 0,
      });
      created = true;
    } else {
      const user = await ctx.db.get("User", userId);
      if (user === null) throw convexError(ErrorCode.ACCOUNT_NOT_FOUND, "SCIM user not found.");
      const conflictingIdentity = await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("user_id", (idx) => idx.eq("userId", userId))
        .filter((query) => query.neq(query.field("connectionId"), args.connectionId))
        .first();
      if (conflictingIdentity !== null) {
        throw convexError(
          ErrorCode.ACCOUNT_ALREADY_LINKED,
          "User is managed by another SCIM connection.",
        );
      }
      const patch = patchProfile(
        user as Record<string, unknown>,
        args.userData,
        args.profileUpdate,
      );
      if (Object.keys(patch).length > 0) await ctx.db.patch("User", userId, patch);
    }
    if (externalId !== undefined && account === null)
      await ctx.db.insert("Account", { userId, provider, providerAccountId: externalId });
    const identityData: ScimUserIdentity = {
      connectionId: args.connectionId,
      groupId: connection.groupId,
      resourceType: "user",
      ...(externalId === undefined ? {} : { externalId }),
      userId,
      active: args.active !== false,
      ...(args.lastProvisionedAt === undefined
        ? {}
        : { lastProvisionedAt: args.lastProvisionedAt }),
      ...(args.raw === undefined ? {} : { raw: args.raw }),
    };
    if (identity === null) await ctx.db.insert("GroupConnectionScimIdentity", identityData);
    else {
      if (identity.groupId !== connection.groupId)
        throw convexError(ErrorCode.INVALID_PARAMETERS, "SCIM identity group mismatch.");
      await ctx.db.patch("GroupConnectionScimIdentity", identity._id, identityData);
    }
    const membership = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (idx) =>
        idx.eq("groupId", connection.groupId).eq("userId", userId),
      )
      .unique();
    const membershipPatch = {
      roleIds: args.roleIds,
      status: args.active === false ? "inactive" : "active",
    };
    if (membership === null)
      await ctx.db.insert("GroupMember", {
        groupId: connection.groupId,
        userId,
        ...membershipPatch,
      });
    else await ctx.db.patch("GroupMember", membership._id, membershipPatch);
    return { userId, created };
  },
});

/** Atomically update a directory-managed user and its connection membership. */
export const update = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    userId: v.id("User"),
    externalId: v.optional(v.string()),
    userData: vScimUserData,
    profileUpdate: vGroupConnectionProfileUpdateMode,
    roleIds: v.array(v.string()),
    active: v.boolean(),
    lastProvisionedAt: v.optional(v.number()),
    raw: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    const externalId = args.externalId;
    const identity = await requireScimUserIdentity(ctx, {
      connectionId: args.connectionId,
      userId: args.userId,
      groupId: connection.groupId,
    });
    const conflicting =
      externalId === undefined
        ? null
        : await ctx.db
            .query("GroupConnectionScimIdentity")
            .withIndex("group_connection_id_resource_type_external_id", (idx) =>
              idx
                .eq("connectionId", args.connectionId)
                .eq("resourceType", "user")
                .eq("externalId", externalId),
            )
            .unique();
    if (conflicting !== null && conflicting._id !== identity._id)
      throw convexError(ErrorCode.ACCOUNT_ALREADY_LINKED, "SCIM external id is already linked.");
    const user = await ctx.db.get("User", args.userId);
    if (user === null) throw convexError(ErrorCode.ACCOUNT_NOT_FOUND, "User not found.");
    const provider = providerForConnection(connection);
    const currentExternalId = identity.externalId;
    const [currentAccount, nextAccount] = await Promise.all([
      scimAccountByExternalId(ctx, provider, currentExternalId),
      currentExternalId === externalId
        ? Promise.resolve(null)
        : scimAccountByExternalId(ctx, provider, externalId),
    ]);
    if (nextAccount !== null && nextAccount.userId !== args.userId) {
      throw convexError(
        ErrorCode.ACCOUNT_ALREADY_LINKED,
        "The replacement SCIM external id is already linked.",
      );
    }
    if (currentAccount !== null && currentAccount.userId !== args.userId) {
      throw convexError(
        ErrorCode.ACCOUNT_ALREADY_LINKED,
        "The SCIM account belongs to another user.",
      );
    }
    const patch = patchProfile(user as Record<string, unknown>, args.userData, args.profileUpdate);
    if (Object.keys(patch).length > 0) await ctx.db.patch("User", args.userId, patch);
    if (currentExternalId === externalId) {
      if (externalId !== undefined && currentAccount === null) {
        await ctx.db.insert("Account", {
          userId: args.userId,
          provider,
          providerAccountId: externalId,
        });
      }
    } else if (currentAccount !== null) {
      if (externalId === undefined) {
        await ctx.db.delete("Account", currentAccount._id);
      } else if (nextAccount === null) {
        await ctx.db.patch("Account", currentAccount._id, { providerAccountId: externalId });
      } else {
        await ctx.db.delete("Account", currentAccount._id);
      }
    } else if (externalId !== undefined && nextAccount === null) {
      await ctx.db.insert("Account", {
        userId: args.userId,
        provider,
        providerAccountId: externalId,
      });
    }
    await ctx.db.patch("GroupConnectionScimIdentity", identity._id, {
      externalId,
      active: args.active,
      lastProvisionedAt: args.lastProvisionedAt,
      raw: args.raw,
    });
    const membership = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (idx) =>
        idx.eq("groupId", connection.groupId).eq("userId", args.userId),
      )
      .unique();
    const membershipPatch = { roleIds: args.roleIds, status: args.active ? "active" : "inactive" };
    if (membership === null)
      await ctx.db.insert("GroupMember", {
        groupId: connection.groupId,
        userId: args.userId,
        ...membershipPatch,
      });
    else await ctx.db.patch("GroupMember", membership._id, membershipPatch);
    return null;
  },
});

/** Atomically revoke a directory-managed user's membership, sessions, and identity. */
export const revoke = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    userId: v.id("User"),
    mode: vGroupConnectionDeprovisionMode,
  },
  returns: v.object({
    epoch: v.number(),
    cleanedSessions: v.number(),
    cleanupPending: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    const identity = await requireScimUserIdentity(ctx, {
      connectionId: args.connectionId,
      userId: args.userId,
      groupId: connection.groupId,
    });
    const provider = providerForConnection(connection);
    const externalId = identity.externalId;
    const account = await scimAccountByExternalId(ctx, provider, externalId);
    if (account !== null && account.userId !== args.userId) {
      throw convexError(
        ErrorCode.ACCOUNT_ALREADY_LINKED,
        "The SCIM account belongs to another user.",
      );
    }
    const membership = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (idx) =>
        idx.eq("groupId", connection.groupId).eq("userId", args.userId),
      )
      .unique();
    if (membership !== null) await ctx.db.delete("GroupMember", membership._id);
    if (account !== null) await ctx.db.delete("Account", account._id);
    const { epoch, cleanedSessions, cleanupPending } = await revokeSessionState(ctx, args.userId);
    if (args.mode === "hard") await ctx.db.delete("GroupConnectionScimIdentity", identity._id);
    else
      await ctx.db.patch("GroupConnectionScimIdentity", identity._id, {
        active: false,
        lastProvisionedAt: Date.now(),
      });
    return { epoch, cleanedSessions, cleanupPending };
  },
});

async function activeScimConnection(ctx: MutationCtx, connectionId: Id<"GroupConnection">) {
  const connection = await ctx.db.get("GroupConnection", connectionId);
  const scim =
    connection === null
      ? null
      : await ctx.db
          .query("GroupConnectionScimConfig")
          .withIndex("group_connection_id", (idx) => idx.eq("connectionId", connectionId))
          .unique();
  if (
    connection === null ||
    connection.status !== "active" ||
    scim === null ||
    scim.status !== "active" ||
    scim.groupId !== connection.groupId
  ) {
    throw convexError(ErrorCode.INVALID_PARAMETERS, "SCIM connection is not active.");
  }
  return connection;
}

async function assertScimMembers(
  ctx: MutationCtx,
  connection: { _id: Id<"GroupConnection">; groupId: Id<"Group"> },
  userIds: Array<Id<"User">>,
) {
  for (const userId of new Set(userIds)) {
    const [user, identity, membership] = await Promise.all([
      ctx.db.get("User", userId),
      ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("group_connection_id_user_id", (idx) =>
          idx.eq("connectionId", connection._id).eq("userId", userId),
        )
        .first(),
      ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (idx) =>
          idx.eq("groupId", connection.groupId).eq("userId", userId),
        )
        .first(),
    ]);
    if (user === null || (identity === null && membership === null)) {
      throw convexError(
        ErrorCode.ACCOUNT_NOT_FOUND,
        "A SCIM group member is not available through this connection.",
      );
    }
  }
}

async function replaceScimGroupMembers(
  ctx: MutationCtx,
  groupId: Id<"Group">,
  memberIds: Array<Id<"User">>,
  roleIds: Array<string>,
  cursor: string | undefined,
) {
  assertScimMembershipBatchSize(memberIds);
  const wanted = new Set(memberIds);
  const patch = { roleIds, status: "active" as const };
  for (const userId of wanted) {
    const member = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (idx) => idx.eq("groupId", groupId).eq("userId", userId))
      .unique();
    if (member === null) await ctx.db.insert("GroupMember", { groupId, userId, ...patch });
    else await ctx.db.patch("GroupMember", member._id, patch);
  }
  const current = await paginator(ctx.db, schema)
    .query("GroupMember")
    .withIndex("group_id", (idx) => idx.eq("groupId", groupId))
    .paginate({ numItems: SCIM_GROUP_MEMBERSHIP_BATCH_SIZE, cursor: cursor ?? null });
  for (const member of current.page) {
    if (!wanted.has(member.userId)) await ctx.db.delete("GroupMember", member._id);
  }
  return { isDone: current.isDone, continueCursor: current.continueCursor };
}

/**
 * Provision a SCIM group and one bounded page of its authoritative membership.
 * Repeat with `continueCursor` until `isDone` is true.
 */
export const provisionGroup = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    externalId: v.optional(v.string()),
    name: v.string(),
    memberIds: v.array(v.id("User")),
    roleIds: v.array(v.string()),
    raw: v.optional(v.any()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    groupId: v.id("Group"),
    created: v.boolean(),
    ...vScimMembershipProgress.fields,
  }),
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    const externalId = args.externalId;
    assertScimMembershipBatchSize(args.memberIds);
    await assertScimMembers(ctx, connection, args.memberIds);
    const identity =
      externalId === undefined
        ? null
        : await ctx.db
            .query("GroupConnectionScimIdentity")
            .withIndex("group_connection_id_resource_type_external_id", (idx) =>
              idx
                .eq("connectionId", args.connectionId)
                .eq("resourceType", "group")
                .eq("externalId", externalId),
            )
            .unique();
    if (identity !== null && identity.groupId !== connection.groupId) {
      throw convexError(ErrorCode.INVALID_PARAMETERS, "SCIM identity group mismatch.");
    }
    let groupId = identity?.mappedGroupId;
    let created = false;
    if (groupId === undefined) {
      const parent = await ctx.db.get("Group", connection.groupId);
      if (parent === null)
        throw convexError(ErrorCode.INVALID_PARAMETERS, "Connection group not found.");
      groupId = await ctx.db.insert("Group", {
        name: args.name,
        type: "organization",
        parentGroupId: connection.groupId,
        rootGroupId: parent.rootGroupId ?? parent._id,
        isRoot: false,
      });
      created = true;
    } else {
      const group = await ctx.db.get("Group", groupId);
      if (group === null || group.parentGroupId !== connection.groupId) {
        throw convexError(ErrorCode.INVALID_PARAMETERS, "SCIM group ownership mismatch.");
      }
      await ctx.db.patch("Group", groupId, { name: args.name });
    }
    const identityData = {
      connectionId: args.connectionId,
      groupId: connection.groupId,
      resourceType: "group" as const,
      ...(externalId === undefined ? {} : { externalId }),
      mappedGroupId: groupId,
      active: true,
      lastProvisionedAt: Date.now(),
      ...(args.raw === undefined ? {} : { raw: args.raw }),
    };
    if (identity === null) await ctx.db.insert("GroupConnectionScimIdentity", identityData);
    else await ctx.db.patch("GroupConnectionScimIdentity", identity._id, identityData);
    return {
      groupId,
      created,
      ...(await replaceScimGroupMembers(ctx, groupId, args.memberIds, args.roleIds, args.cursor)),
    };
  },
});

/**
 * Update a SCIM group and one bounded page of its authoritative membership.
 * Repeat with `continueCursor` until `isDone` is true.
 */
export const updateGroup = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    name: v.optional(v.string()),
    memberIds: v.array(v.id("User")),
    roleIds: v.array(v.string()),
    raw: v.optional(v.any()),
    cursor: v.optional(v.string()),
  },
  returns: vScimMembershipProgress,
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    assertScimMembershipBatchSize(args.memberIds);
    const identity = await ctx.db
      .query("GroupConnectionScimIdentity")
      .withIndex("mapped_group_id", (idx) => idx.eq("mappedGroupId", args.groupId))
      .unique();
    if (
      identity === null ||
      identity.connectionId !== args.connectionId ||
      identity.groupId !== connection.groupId ||
      identity.resourceType !== "group"
    ) {
      throw convexError(ErrorCode.ACCOUNT_NOT_FOUND, "SCIM group not found.");
    }
    const group = await ctx.db.get("Group", args.groupId);
    if (group === null || group.parentGroupId !== connection.groupId) {
      throw convexError(ErrorCode.INVALID_PARAMETERS, "SCIM group ownership mismatch.");
    }
    await assertScimMembers(ctx, connection, args.memberIds);
    if (args.name !== undefined) await ctx.db.patch("Group", args.groupId, { name: args.name });
    await ctx.db.patch("GroupConnectionScimIdentity", identity._id, {
      active: true,
      lastProvisionedAt: Date.now(),
      ...(args.raw === undefined ? {} : { raw: args.raw }),
    });
    return await replaceScimGroupMembers(
      ctx,
      args.groupId,
      args.memberIds,
      args.roleIds,
      args.cursor,
    );
  },
});

/**
 * Revoke a SCIM group in bounded membership pages. The identity and group are
 * removed only when the final page returns `isDone`.
 */
export const revokeGroup = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    cursor: v.optional(v.string()),
  },
  returns: vScimMembershipProgress,
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    const identity = await ctx.db
      .query("GroupConnectionScimIdentity")
      .withIndex("mapped_group_id", (idx) => idx.eq("mappedGroupId", args.groupId))
      .unique();
    if (
      identity === null ||
      identity.connectionId !== args.connectionId ||
      identity.groupId !== connection.groupId ||
      identity.resourceType !== "group"
    ) {
      throw convexError(ErrorCode.ACCOUNT_NOT_FOUND, "SCIM group not found.");
    }
    const group = await ctx.db.get("Group", args.groupId);
    if (group === null || group.parentGroupId !== identity.groupId) {
      throw convexError(ErrorCode.INVALID_PARAMETERS, "SCIM group ownership mismatch.");
    }
    const members = await paginator(ctx.db, schema)
      .query("GroupMember")
      .withIndex("group_id", (idx) => idx.eq("groupId", args.groupId))
      .paginate({ numItems: SCIM_GROUP_MEMBERSHIP_BATCH_SIZE, cursor: args.cursor ?? null });
    for (const member of members.page) await ctx.db.delete("GroupMember", member._id);
    if (members.isDone) {
      await ctx.db.delete("GroupConnectionScimIdentity", identity._id);
      await ctx.db.delete("Group", args.groupId);
    }
    return { isDone: members.isDone, continueCursor: members.continueCursor };
  },
});
