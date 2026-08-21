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
import { ConvexError, type Infer, v } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";

import { ErrorCode } from "../../../shared/codes";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { mutation, query } from "../../functions";
import { vGroupConnectionScimIdentityDoc, vPaginated, vScimResourceType } from "../../model";
import schema from "../../schema";
import { revokeSessionRows } from "../../session";

const vScimUserData = v.object(schema.tables.User.validator.fields);
const vProfileUpdate = v.union(v.literal("never"), v.literal("missing"), v.literal("always"));

type ScimUserData = Infer<typeof vScimUserData>;
type ProfileUpdate = Infer<typeof vProfileUpdate>;

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
 * the input order (`null` per missing user). Otherwise it resolves a single
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
  throw new ConvexError({
    code: ErrorCode.PROVIDER_NOT_CONFIGURED,
    message: "SCIM requires an OIDC or SAML connection.",
  });
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
    profileUpdate: vProfileUpdate,
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
    const account =
      externalId === undefined
        ? null
        : await ctx.db
            .query("Account")
            .withIndex("provider_account_id", (idx) =>
              idx.eq("provider", provider).eq("providerAccountId", externalId),
            )
            .unique();
    if (identity?.userId !== undefined && account !== null && identity.userId !== account.userId) {
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_ALREADY_LINKED,
        message: "SCIM account ownership conflicts.",
      });
    }
    let userId = identity?.userId ?? account?.userId;
    let created = false;
    if (userId === undefined) {
      userId = await ctx.db.insert("User", args.userData);
      created = true;
    } else {
      const user = await ctx.db.get("User", userId);
      if (user === null)
        throw new ConvexError({
          code: ErrorCode.ACCOUNT_NOT_FOUND,
          message: "SCIM user not found.",
        });
      const conflictingIdentity = await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("user_id", (idx) => idx.eq("userId", userId))
        .filter((query) => query.neq(query.field("connectionId"), args.connectionId))
        .first();
      if (conflictingIdentity !== null) {
        throw new ConvexError({
          code: ErrorCode.ACCOUNT_ALREADY_LINKED,
          message: "User is managed by another SCIM connection.",
        });
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
        throw new ConvexError({
          code: ErrorCode.INVALID_PARAMETERS,
          message: "SCIM identity group mismatch.",
        });
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
    profileUpdate: vProfileUpdate,
    roleIds: v.array(v.string()),
    active: v.boolean(),
    lastProvisionedAt: v.optional(v.number()),
    raw: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    const externalId = args.externalId;
    const identity = await ctx.db
      .query("GroupConnectionScimIdentity")
      .withIndex("group_connection_id_user_id", (idx) =>
        idx.eq("connectionId", args.connectionId).eq("userId", args.userId),
      )
      .unique();
    if (
      identity === null ||
      identity.resourceType !== "user" ||
      identity.groupId !== connection.groupId
    )
      throw new ConvexError({ code: ErrorCode.ACCOUNT_NOT_FOUND, message: "SCIM user not found." });
    const conflictingIdentity = await ctx.db
      .query("GroupConnectionScimIdentity")
      .withIndex("user_id", (idx) => idx.eq("userId", args.userId))
      .filter((query) => query.neq(query.field("connectionId"), args.connectionId))
      .first();
    if (conflictingIdentity !== null) {
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_ALREADY_LINKED,
        message: "User is managed by another SCIM connection.",
      });
    }
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
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_ALREADY_LINKED,
        message: "SCIM external id is already linked.",
      });
    const user = await ctx.db.get("User", args.userId);
    if (user === null)
      throw new ConvexError({ code: ErrorCode.ACCOUNT_NOT_FOUND, message: "User not found." });
    const provider = providerForConnection(connection);
    const currentExternalId = identity.externalId;
    const [currentAccount, nextAccount] = await Promise.all([
      currentExternalId === undefined
        ? Promise.resolve(null)
        : ctx.db
            .query("Account")
            .withIndex("provider_account_id", (idx) =>
              idx.eq("provider", provider).eq("providerAccountId", currentExternalId),
            )
            .unique(),
      externalId === undefined || currentExternalId === externalId
        ? Promise.resolve(null)
        : ctx.db
            .query("Account")
            .withIndex("provider_account_id", (idx) =>
              idx.eq("provider", provider).eq("providerAccountId", externalId),
            )
            .unique(),
    ]);
    if (nextAccount !== null && nextAccount.userId !== args.userId) {
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_ALREADY_LINKED,
        message: "The replacement SCIM external id is already linked.",
      });
    }
    if (currentAccount !== null && currentAccount.userId !== args.userId) {
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_ALREADY_LINKED,
        message: "The SCIM account belongs to another user.",
      });
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
    mode: v.union(v.literal("soft"), v.literal("hard")),
  },
  returns: v.object({ revoked: v.number() }),
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    const identity = await ctx.db
      .query("GroupConnectionScimIdentity")
      .withIndex("group_connection_id_user_id", (idx) =>
        idx.eq("connectionId", args.connectionId).eq("userId", args.userId),
      )
      .unique();
    if (
      identity === null ||
      identity.resourceType !== "user" ||
      identity.groupId !== connection.groupId
    )
      throw new ConvexError({ code: ErrorCode.ACCOUNT_NOT_FOUND, message: "SCIM user not found." });
    const conflictingIdentity = await ctx.db
      .query("GroupConnectionScimIdentity")
      .withIndex("user_id", (idx) => idx.eq("userId", args.userId))
      .filter((query) => query.neq(query.field("connectionId"), args.connectionId))
      .first();
    if (conflictingIdentity !== null) {
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_ALREADY_LINKED,
        message: "User is managed by another SCIM connection.",
      });
    }
    const provider = providerForConnection(connection);
    const externalId = identity.externalId;
    const account =
      externalId === undefined
        ? null
        : await ctx.db
            .query("Account")
            .withIndex("provider_account_id", (idx) =>
              idx.eq("provider", provider).eq("providerAccountId", externalId),
            )
            .unique();
    if (account !== null && account.userId !== args.userId) {
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_ALREADY_LINKED,
        message: "The SCIM account belongs to another user.",
      });
    }
    const membership = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (idx) =>
        idx.eq("groupId", connection.groupId).eq("userId", args.userId),
      )
      .unique();
    if (membership !== null) await ctx.db.delete("GroupMember", membership._id);
    if (account !== null) await ctx.db.delete("Account", account._id);
    const revoked = await revokeSessionRows(ctx, args.userId);
    if (args.mode === "hard") await ctx.db.delete("GroupConnectionScimIdentity", identity._id);
    else
      await ctx.db.patch("GroupConnectionScimIdentity", identity._id, {
        active: false,
        lastProvisionedAt: Date.now(),
      });
    return { revoked };
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
    throw new ConvexError({
      code: ErrorCode.INVALID_PARAMETERS,
      message: "SCIM connection is not active.",
    });
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
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_NOT_FOUND,
        message: "A SCIM group member is not available through this connection.",
      });
    }
  }
}

async function replaceScimGroupMembers(
  ctx: MutationCtx,
  groupId: Id<"Group">,
  memberIds: Array<Id<"User">>,
  roleIds: Array<string>,
) {
  const current = await ctx.db
    .query("GroupMember")
    .withIndex("group_id", (idx) => idx.eq("groupId", groupId))
    .collect();
  const wanted = new Set(memberIds);
  for (const member of current) {
    if (!wanted.has(member.userId)) await ctx.db.delete("GroupMember", member._id);
  }
  for (const userId of wanted) {
    const member = current.find((candidate) => candidate.userId === userId);
    const patch = { roleIds, status: "active" as const };
    if (member === undefined) await ctx.db.insert("GroupMember", { groupId, userId, ...patch });
    else await ctx.db.patch("GroupMember", member._id, patch);
  }
}

/** Atomically provision a SCIM group, its identity, and its complete membership. */
export const provisionGroup = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    externalId: v.optional(v.string()),
    name: v.string(),
    memberIds: v.array(v.id("User")),
    roleIds: v.array(v.string()),
    raw: v.optional(v.any()),
  },
  returns: v.object({ groupId: v.id("Group"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const connection = await activeScimConnection(ctx, args.connectionId);
    const externalId = args.externalId;
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
      throw new ConvexError({
        code: ErrorCode.INVALID_PARAMETERS,
        message: "SCIM identity group mismatch.",
      });
    }
    let groupId = identity?.mappedGroupId;
    let created = false;
    if (groupId === undefined) {
      const parent = await ctx.db.get("Group", connection.groupId);
      if (parent === null)
        throw new ConvexError({
          code: ErrorCode.INVALID_PARAMETERS,
          message: "Connection group not found.",
        });
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
        throw new ConvexError({
          code: ErrorCode.INVALID_PARAMETERS,
          message: "SCIM group ownership mismatch.",
        });
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
    await replaceScimGroupMembers(ctx, groupId, args.memberIds, args.roleIds);
    return { groupId, created };
  },
});

/** Atomically update a SCIM group and replace its complete membership. */
export const updateGroup = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    name: v.optional(v.string()),
    memberIds: v.array(v.id("User")),
    roleIds: v.array(v.string()),
    raw: v.optional(v.any()),
  },
  returns: v.null(),
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
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_NOT_FOUND,
        message: "SCIM group not found.",
      });
    }
    const group = await ctx.db.get("Group", args.groupId);
    if (group === null || group.parentGroupId !== connection.groupId) {
      throw new ConvexError({
        code: ErrorCode.INVALID_PARAMETERS,
        message: "SCIM group ownership mismatch.",
      });
    }
    await assertScimMembers(ctx, connection, args.memberIds);
    if (args.name !== undefined) await ctx.db.patch("Group", args.groupId, { name: args.name });
    await ctx.db.patch("GroupConnectionScimIdentity", identity._id, {
      active: true,
      lastProvisionedAt: Date.now(),
      ...(args.raw === undefined ? {} : { raw: args.raw }),
    });
    await replaceScimGroupMembers(ctx, args.groupId, args.memberIds, args.roleIds);
    return null;
  },
});

/** Atomically revoke a SCIM group and its identity after verifying connection ownership. */
export const revokeGroup = mutation({
  args: { connectionId: v.id("GroupConnection"), groupId: v.id("Group") },
  returns: v.null(),
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
      throw new ConvexError({
        code: ErrorCode.ACCOUNT_NOT_FOUND,
        message: "SCIM group not found.",
      });
    }
    const group = await ctx.db.get("Group", args.groupId);
    if (group === null || group.parentGroupId !== identity.groupId) {
      throw new ConvexError({
        code: ErrorCode.INVALID_PARAMETERS,
        message: "SCIM group ownership mismatch.",
      });
    }
    const members = await ctx.db
      .query("GroupMember")
      .withIndex("group_id", (idx) => idx.eq("groupId", args.groupId))
      .collect();
    for (const member of members) await ctx.db.delete("GroupMember", member._id);
    await ctx.db.delete("GroupConnectionScimIdentity", identity._id);
    await ctx.db.delete("Group", args.groupId);
    return null;
  },
});
