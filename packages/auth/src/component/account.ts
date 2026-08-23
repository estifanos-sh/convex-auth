/**
 * `component.account.*` — provider-linked auth accounts.
 *
 * Reads collapse into one overloaded `get`; `list`
 * takes the owning `userId`.
 *
 * @module
 */

import { v } from "convex/values";
import { ErrorCode } from "../shared/codes";
import { convexError } from "../shared/errors";

import { recordSignInLimit, resetSignInLimit } from "./limits";
import { mutation, query } from "./_generated/server";
import { vAccountDoc, vUserDoc } from "./documents";
import { createSessionRows, type SessionRows, vSessionReplacement } from "./session";

/** Maximum linked accounts returned for one user by the bounded read surface. */
const ACCOUNT_LIST_BATCH = 128;

/** Maximum users accepted by one batched account read. */
const ACCOUNT_LIST_USER_BATCH = 100;

type AcceptedCredentialsSignIn = Omit<SessionRows, "epoch"> & { status: "accepted" };

/** Reserve a password attempt and load all sign-in state in one transaction. */
export const beginCredentialsSignIn = mutation({
  args: {
    provider: v.string(),
    providerAccountId: v.string(),
    limitIdentifier: v.string(),
    maxAttemptsPerHour: v.number(),
    reserveAttempt: v.boolean(),
    includeTotp: v.boolean(),
  },
  returns: v.union(
    v.object({ status: v.literal("invalid") }),
    v.object({ status: v.literal("limited") }),
    v.object({
      status: v.literal("ready"),
      account: vAccountDoc,
      user: vUserDoc,
      hasTotp: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.reserveAttempt
      ? await recordSignInLimit(ctx, {
          identifier: args.limitIdentifier,
          maxAttemptsPerHour: args.maxAttemptsPerHour,
        })
      : { ok: true as const, retryAfter: undefined };
    if (!limit.ok) return { status: "limited" as const };

    const account = await ctx.db
      .query("Account")
      .withIndex("provider_account_id", (q) =>
        q.eq("provider", args.provider).eq("providerAccountId", args.providerAccountId),
      )
      .unique();
    if (account === null) return { status: "invalid" as const };

    const [user, totp] = await Promise.all([
      ctx.db.get("User", account.userId),
      args.includeTotp
        ? ctx.db
            .query("TotpFactor")
            .withIndex("user_id_verified", (q) =>
              q.eq("userId", account.userId).eq("verified", true),
            )
            .first()
        : Promise.resolve(null),
    ]);
    if (user === null) return { status: "invalid" as const };
    return {
      status: "ready" as const,
      account,
      user,
      hasTotp: totp !== null,
    };
  },
});

/** Refund a verified password attempt and optionally issue its session atomically. */
export const completeCredentialsSignIn = mutation({
  args: {
    accountId: v.id("Account"),
    limitIdentifier: v.string(),
    issueSession: v.boolean(),
    generateTokens: v.boolean(),
    replaceSession: v.optional(vSessionReplacement),
    sessionExpirationTime: v.number(),
    refreshTokenExpirationTime: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("rejected") }),
    v.object({ status: v.literal("reset") }),
    v.object({
      status: v.literal("accepted"),
      user: vUserDoc,
      sessionId: v.id("Session"),
      sessionExpirationTime: v.number(),
      refreshTokenId: v.optional(v.id("RefreshToken")),
      replacedSessionId: v.optional(v.id("Session")),
    }),
  ),
  handler: async (ctx, args) => {
    const account = await ctx.db.get("Account", args.accountId);
    if (account === null) return { status: "rejected" as const };
    await resetSignInLimit(ctx, args.limitIdentifier);
    if (!args.issueSession) return { status: "reset" as const };

    const created = await createSessionRows(ctx, {
      userId: account.userId,
      replaceSession: args.replaceSession,
      sessionExpirationTime: args.sessionExpirationTime,
      refreshTokenExpirationTime: args.generateTokens ? args.refreshTokenExpirationTime : undefined,
    });
    if (created === null) return { status: "rejected" as const };
    const result: AcceptedCredentialsSignIn = {
      status: "accepted" as const,
      user: created.user,
      sessionId: created.sessionId,
      sessionExpirationTime: created.sessionExpirationTime,
    };
    if (created.refreshTokenId !== undefined) result.refreshTokenId = created.refreshTokenId;
    if (created.replacedSessionId !== undefined) {
      result.replacedSessionId = created.replacedSessionId;
    }
    return result;
  },
});

/**
 * Read an account by id, or by `{ provider, providerAccountId }` when both
 * are given. Returns `null` when no selector matches.
 */
export const get = query({
  args: {
    id: v.optional(v.id("Account")),
    provider: v.optional(v.string()),
    providerAccountId: v.optional(v.string()),
  },
  returns: v.union(vAccountDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.provider !== undefined && args.providerAccountId !== undefined) {
      return await ctx.db
        .query("Account")
        .withIndex("provider_account_id", (q) =>
          q.eq("provider", args.provider!).eq("providerAccountId", args.providerAccountId!),
        )
        .unique();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("Account", args.id);
  },
});

/**
 * List the accounts owned by one user, or by a bounded batch of users.
 *
 * The batch form serves one component crossing for app-owned user lists. The
 * public server facade projects these raw records into safe capability
 * summaries before exposing them to application code.
 */
export const list = query({
  args: {
    userId: v.optional(v.id("User")),
    userIds: v.optional(v.array(v.id("User"))),
    provider: v.optional(v.string()),
  },
  returns: v.array(vAccountDoc),
  handler: async (ctx, args) => {
    const userIds = args.userId === undefined ? (args.userIds ?? []) : [args.userId];
    const uniqueUserIds = Array.from(new Set(userIds));
    const provider = args.provider;
    if (uniqueUserIds.length > ACCOUNT_LIST_USER_BATCH) {
      throw convexError(
        ErrorCode.INVALID_PARAMETERS,
        `At most ${ACCOUNT_LIST_USER_BATCH} users can be read at once.`,
      );
    }
    const accounts = await Promise.all(
      uniqueUserIds.map(async (userId) =>
        provider === undefined
          ? await ctx.db
              .query("Account")
              .withIndex("user_id_provider", (q) => q.eq("userId", userId))
              .take(ACCOUNT_LIST_BATCH)
          : await ctx.db
              .query("Account")
              .withIndex("user_id_provider", (q) => q.eq("userId", userId).eq("provider", provider))
              .take(ACCOUNT_LIST_BATCH),
      ),
    );
    return accounts.flat();
  },
});

/** Insert a new account. */
export const create = mutation({
  args: {
    userId: v.id("User"),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
    extend: v.optional(v.any()),
  },
  returns: v.id("Account"),
  handler: async (ctx, args) => {
    // Dedup on the (provider, providerAccountId) identity. A bare insert let two
    // concurrent or retried provisioning ceremonies — SCIM POST retries, a
    // passkey double-submit — create duplicate Account rows, which then made
    // `account.get(...).unique()` throw on every future lookup (a permanent
    // sign-in lockout / rogue credential attribution). The index-range read plus
    // insert in this single mutation is OCC-atomic: a racing insert into the same
    // range conflicts and retries, then observes the winner's row below.
    const existing = await ctx.db
      .query("Account")
      .withIndex("provider_account_id", (q) =>
        q.eq("provider", args.provider).eq("providerAccountId", args.providerAccountId),
      )
      .first();
    if (existing !== null) {
      if (existing.userId !== args.userId) {
        // Already linked to a different user — reject rather than silently
        // attribute the identity (e.g. an attacker registering a passkey
        // credentialId that already belongs to a victim).
        throw convexError(
          ErrorCode.ACCOUNT_ALREADY_LINKED,
          "This account is already linked to another user.",
        );
      }
      return existing._id;
    }
    return await ctx.db.insert("Account", args);
  },
});

/** Patch fields on an account. */
export const update = mutation({
  args: {
    id: v.id("Account"),
    patch: v.object({
      userId: v.optional(v.id("User")),
      provider: v.optional(v.string()),
      providerAccountId: v.optional(v.string()),
      secret: v.optional(v.string()),
      emailVerified: v.optional(v.string()),
      phoneVerified: v.optional(v.string()),
      extend: v.optional(v.any()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id: accountId, patch }) => {
    await ctx.db.patch("Account", accountId, patch);
    return null;
  },
});

/**
 * Delete an account. When `requireOtherAccount` is set, refuses to delete the
 * user's last remaining account so they are never left with none.
 */
const remove = mutation({
  args: {
    id: v.id("Account"),
    userId: v.optional(v.id("User")),
    requireOtherAccount: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id: accountId, userId, requireOtherAccount }) => {
    const doc = await ctx.db.get("Account", accountId);
    if (doc === null || (userId !== undefined && doc.userId !== userId)) {
      throw convexError(ErrorCode.ACCOUNT_NOT_FOUND, "Account not found.");
    }
    if (requireOtherAccount === true) {
      let otherFound = false;
      for await (const sibling of ctx.db
        .query("Account")
        .withIndex("user_id_provider", (q) => q.eq("userId", doc.userId))) {
        if (sibling._id !== accountId) {
          otherFound = true;
          break;
        }
      }
      if (!otherFound) {
        throw convexError(ErrorCode.INVALID_PARAMETERS, "The provided parameters are invalid.");
      }
    }
    await ctx.db.delete("Account", accountId);
    return null;
  },
});

export { remove };
