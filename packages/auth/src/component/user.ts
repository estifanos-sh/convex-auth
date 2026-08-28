/**
 * `component.user.*` — the User entity surface.
 *
 * Reads collapse into one overloaded `get`; the rest are 1:1 verbs.
 *
 * @module
 */

import { stream } from "convex-helpers/server/stream";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { ErrorCode } from "../shared/codes";
import { convexError } from "../shared/errors";

import { mutation, query } from "./_generated/server";
import { assertBatchSelectorSize } from "./batch";
import type { Doc } from "./_generated/dataModel";
import { vUserDoc } from "./documents";
import { vPaginated, vSortOrder } from "./model";
import schema from "./schema";

const vUserInsertData = schema.tables.User.validator.omit("sessionEpoch");

const vUserPatchData = schema.tables.User.validator.partial();

/**
 * Keep one complete user cascade within a single safe transaction.
 */
const CASCADE_MAX = 100;

function assertCascadeSize(count: number) {
  if (count > CASCADE_MAX) {
    throw convexError(
      ErrorCode.CASCADE_TOO_LARGE,
      `User cascade has more than ${CASCADE_MAX} dependent rows; delete child rows in bounded batches, then retry.`,
    );
  }
}

function uniqueRows<T extends { _id: string }>(rows: T[]) {
  return Array.from(new Map(rows.map((row) => [row._id, row])).values());
}

/**
 * Read a user by identity. One overloaded function (single Convex
 * function with a unioned `args`/`returns`). Accepts exactly one
 * selector:
 *
 * - `{ id }`           → `Doc<"User"> | null`
 * - `{ ids }`          → `(Doc<"User"> | null)[]` (order preserved, deduped; max 100 IDs)
 * - `{ verifiedEmail }`→ `Doc<"User"> | null` (exactly-one-or-null)
 * - `{ verifiedPhone }`→ `Doc<"User"> | null` (exactly-one-or-null)
 *
 * @example
 * ```ts
 * await ctx.runQuery(component.user.get, { id: userId });
 * await ctx.runQuery(component.user.get, { ids: memberIds });
 * await ctx.runQuery(component.user.get, { verifiedEmail: "a@b.com" });
 * ```
 */
export const get = query({
  args: {
    id: v.optional(schema.id("User")),
    ids: v.optional(v.array(schema.id("User"))),
    verifiedEmail: v.optional(v.string()),
    verifiedPhone: v.optional(v.string()),
  },
  returns: v.union(vUserDoc, v.null(), v.array(v.union(vUserDoc, v.null()))),
  handler: async (ctx, args) => {
    if (args.ids !== undefined) {
      assertBatchSelectorSize(args.ids, "ids");
      if (args.ids.length === 0) return [];
      const unique = Array.from(new Set(args.ids));
      const docs = await Promise.all(unique.map((id) => ctx.db.get("User", id)));
      const byId = new Map(unique.map((id, i) => [id, docs[i] ?? null]));
      return args.ids.map((id) => byId.get(id) ?? null);
    }
    if (args.verifiedEmail !== undefined) {
      const users = await ctx.db
        .query("User")
        .withIndex("email_verified", (q) =>
          q.eq("email", args.verifiedEmail!).gt("emailVerificationTime", undefined),
        )
        .take(2);
      return users.length === 1 ? users[0] : null;
    }
    if (args.verifiedPhone !== undefined) {
      const users = await ctx.db
        .query("User")
        .withIndex("phone_verified", (q) =>
          q.eq("phone", args.verifiedPhone!).gt("phoneVerificationTime", undefined),
        )
        .take(2);
      return users.length === 1 ? users[0] : null;
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("User", args.id);
  },
});

/** List users, paginated, with optional `where` filters and ordering. */
export const list = query({
  args: {
    where: v.optional(
      v.object({
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        isAnonymous: v.optional(v.boolean()),
        name: v.optional(v.string()),
      }),
    ),
    paginationOpts: paginationOptsValidator,
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("email"),
        v.literal("phone"),
      ),
    ),
    order: v.optional(vSortOrder),
  },
  returns: vPaginated(vUserDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const order = args.order ?? "desc";
    const orderBy = args.orderBy ?? "_creationTime";

    const base = stream(ctx.db, schema).query("User");
    let q;
    if (orderBy === "email" || where.email !== undefined) {
      q =
        where.email !== undefined
          ? base.withIndex("email", (idx) => idx.eq("email", where.email!))
          : base.withIndex("email");
    } else if (orderBy === "phone" || where.phone !== undefined) {
      q =
        where.phone !== undefined
          ? base.withIndex("phone", (idx) => idx.eq("phone", where.phone!))
          : base.withIndex("phone");
    } else {
      q = base;
    }

    return await q
      .order(order)
      .filterWith(
        async (d) =>
          (where.isAnonymous === undefined || (d.isAnonymous ?? false) === where.isAnonymous) &&
          (where.name === undefined || d.name === where.name) &&
          (where.email === undefined || d.email === where.email) &&
          (where.phone === undefined || d.phone === where.phone),
      )
      .paginate(args.paginationOpts);
  },
});

/** Insert a new user. */
export const create = mutation({
  args: { data: vUserInsertData },
  returns: schema.id("User"),
  handler: async (ctx, { data }) => {
    return await ctx.db.insert("User", { ...data, sessionEpoch: 0 });
  },
});

/** Insert a user, or patch it when `id` is supplied. Returns the user id. */
export const upsert = mutation({
  args: { id: v.optional(schema.id("User")), data: vUserInsertData },
  returns: schema.id("User"),
  handler: async (ctx, { id, data }) => {
    if (id !== undefined) {
      await ctx.db.patch("User", id, data);
      return id;
    }
    return await ctx.db.insert("User", { ...data, sessionEpoch: 0 });
  },
});

/** Patch fields on a user. */
export const update = mutation({
  args: { id: schema.id("User"), patch: vUserPatchData },
  returns: v.null(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch("User", id, patch);
    return null;
  },
});

/** Delete a user and every auth-owned credential row in one bounded transaction. */
const remove = mutation({
  args: { id: schema.id("User") },
  returns: v.null(),
  handler: async (ctx, { id: userId }) => {
    const user = await ctx.db.get("User", userId);
    if (user === null) return null;
    // Read the complete deletion plan before making any write. Every lookup is
    // bounded; any over-limit path throws before the first delete/patch.
    const [
      sessions,
      accounts,
      keys,
      members,
      passkeys,
      totps,
      emails,
      devicesByUser,
      scimIdentities,
      continuations,
      oauthCodesByUser,
      oauthGrantsByUser,
      oauthClients,
      invitesByAuthor,
      invitesByAcceptor,
      webhooks,
    ] = await Promise.all([
      ctx.db
        .query("Session")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("Account")
        .withIndex("user_id_provider", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("ApiKey")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("GroupMember")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("Passkey")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("TotpFactor")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("UserEmail")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("DeviceCode")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("AuthContinuation")
        .withIndex("user_id_provider_operation_expiration_time", (q) =>
          q.eq("subject.userId", userId),
        )
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("OAuthCode")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("OAuthRefreshGrant")
        .withIndex("user_id", (q) => q.eq("userId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("OAuthClient")
        .withIndex("created_by", (q) => q.eq("createdBy", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("GroupInvite")
        .withIndex("invited_by_user_id_status", (q) => q.eq("invitedByUserId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("GroupInvite")
        .withIndex("accepted_by_user_id", (q) => q.eq("acceptedByUserId", userId))
        .take(CASCADE_MAX + 1),
      ctx.db
        .query("GroupWebhookEndpoint")
        .withIndex("created_by_user_id", (q) => q.eq("createdByUserId", userId))
        .take(CASCADE_MAX + 1),
    ]);
    assertCascadeSize(
      [
        ...sessions,
        ...accounts,
        ...keys,
        ...members,
        ...passkeys,
        ...totps,
        ...emails,
        ...devicesByUser,
        ...scimIdentities,
        ...continuations,
        ...oauthCodesByUser,
        ...oauthGrantsByUser,
        ...oauthClients,
        ...invitesByAuthor,
        ...invitesByAcceptor,
        ...webhooks,
      ].length,
    );
    let remaining =
      CASCADE_MAX -
      [
        ...sessions,
        ...accounts,
        ...keys,
        ...members,
        ...passkeys,
        ...totps,
        ...emails,
        ...devicesByUser,
        ...scimIdentities,
        ...continuations,
        ...oauthCodesByUser,
        ...oauthGrantsByUser,
        ...oauthClients,
        ...invitesByAuthor,
        ...invitesByAcceptor,
        ...webhooks,
      ].length;
    async function collect<T>(read: (limit: number) => Promise<T[]>): Promise<T[]> {
      const rows = await read(remaining + 1);
      if (rows.length > remaining) assertCascadeSize(CASCADE_MAX + 1);
      remaining -= rows.length;
      return rows;
    }
    const refreshTokens: Doc<"RefreshToken">[] = [];
    const devicesBySession: Doc<"DeviceCode">[] = [];
    const verificationCodes: Doc<"VerificationCode">[] = [];
    const resetsByAccount: Doc<"PasswordReset">[] = [];
    const resetsByContinuation: Doc<"PasswordReset">[] = [];
    const verifiersBySession: Doc<"AuthVerifier">[] = [];
    const verifiersByContinuation: Doc<"AuthVerifier">[] = [];
    for (const session of sessions) {
      refreshTokens.push(
        ...(await collect((limit) =>
          ctx.db
            .query("RefreshToken")
            .withIndex("session_id", (q) => q.eq("sessionId", session._id))
            .take(limit),
        )),
      );
      devicesBySession.push(
        ...(await collect((limit) =>
          ctx.db
            .query("DeviceCode")
            .withIndex("session_id", (q) => q.eq("sessionId", session._id))
            .take(limit),
        )),
      );
      verifiersBySession.push(
        ...(await collect((limit) =>
          ctx.db
            .query("AuthVerifier")
            .withIndex("session_id", (q) => q.eq("sessionId", session._id))
            .take(limit),
        )),
      );
    }
    for (const account of accounts) {
      verificationCodes.push(
        ...(await collect((limit) =>
          ctx.db
            .query("VerificationCode")
            .withIndex("account_id", (q) => q.eq("accountId", account._id))
            .take(limit),
        )),
      );
      resetsByAccount.push(
        ...(await collect((limit) =>
          ctx.db
            .query("PasswordReset")
            .withIndex("account_id", (q) => q.eq("accountId", account._id))
            .take(limit),
        )),
      );
    }
    for (const continuation of continuations) {
      resetsByContinuation.push(
        ...(await collect((limit) =>
          ctx.db
            .query("PasswordReset")
            .withIndex("continuation_id", (q) => q.eq("continuationId", continuation._id))
            .take(limit),
        )),
      );
      verifiersByContinuation.push(
        ...(await collect((limit) =>
          ctx.db
            .query("AuthVerifier")
            .withIndex("continuation_id", (q) => q.eq("continuationId", continuation._id))
            .take(limit),
        )),
      );
    }
    const grants = oauthGrantsByUser;
    const oauthTokens: Doc<"OAuthRefreshToken">[] = [];
    for (const grant of grants) {
      oauthTokens.push(
        ...(await collect((limit) =>
          ctx.db
            .query("OAuthRefreshToken")
            .withIndex("grant_id", (q) => q.eq("grantId", grant._id))
            .take(limit),
        )),
      );
    }
    const devices = uniqueRows([...devicesByUser, ...devicesBySession]);
    const resets = uniqueRows([...resetsByAccount, ...resetsByContinuation]);
    const verifiers = uniqueRows([...verifiersBySession, ...verifiersByContinuation]);
    const oauthCodes = oauthCodesByUser;
    const invites = uniqueRows([...invitesByAuthor, ...invitesByAcceptor]);
    assertCascadeSize(
      [
        ...sessions,
        ...accounts,
        ...keys,
        ...members,
        ...passkeys,
        ...totps,
        ...emails,
        ...devices,
        ...scimIdentities,
        ...continuations,
        ...oauthCodes,
        ...grants,
        ...oauthClients,
        ...invites,
        ...webhooks,
        ...refreshTokens,
        ...verificationCodes,
        ...resets,
        ...verifiers,
        ...oauthTokens,
      ].length,
    );
    await Promise.all([
      ...sessions.map((s) => ctx.db.delete("Session", s._id)),
      ...refreshTokens.map((r) => ctx.db.delete("RefreshToken", r._id)),
      ...accounts.map((a) => ctx.db.delete("Account", a._id)),
      ...keys.map((k) => ctx.db.delete("ApiKey", k._id)),
      ...members.map((m) => ctx.db.delete("GroupMember", m._id)),
      ...passkeys.map((p) => ctx.db.delete("Passkey", p._id)),
      ...totps.map((t) => ctx.db.delete("TotpFactor", t._id)),
      ...emails.map((email) => ctx.db.delete("UserEmail", email._id)),
      ...devices.map((device) => ctx.db.delete("DeviceCode", device._id)),
      ...scimIdentities.map((identity) =>
        ctx.db.delete("GroupConnectionScimIdentity", identity._id),
      ),
      ...continuations.map((continuation) => ctx.db.delete("AuthContinuation", continuation._id)),
      ...oauthCodes.map((code) => ctx.db.delete("OAuthCode", code._id)),
      ...grants.map((grant) => ctx.db.delete("OAuthRefreshGrant", grant._id)),
      ...oauthTokens.map((token) => ctx.db.delete("OAuthRefreshToken", token._id)),
      ...verificationCodes.map((code) => ctx.db.delete("VerificationCode", code._id)),
      ...resets.map((reset) => ctx.db.delete("PasswordReset", reset._id)),
      ...verifiers.map((verifier) => ctx.db.delete("AuthVerifier", verifier._id)),
      ...oauthClients.map((client) =>
        ctx.db.patch("OAuthClient", client._id, { createdBy: undefined }),
      ),
      ...invites.map((invite) =>
        ctx.db.patch("GroupInvite", invite._id, {
          invitedByUserId: invite.invitedByUserId === userId ? undefined : invite.invitedByUserId,
          acceptedByUserId:
            invite.acceptedByUserId === userId ? undefined : invite.acceptedByUserId,
        }),
      ),
      ...webhooks.map((webhook) =>
        ctx.db.patch("GroupWebhookEndpoint", webhook._id, { createdByUserId: undefined }),
      ),
    ]);
    await ctx.db.delete("User", userId);
    return null;
  },
});

export { remove };
