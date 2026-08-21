/**
 * `component.token.continuation.*` — provider enrollment continuations.
 *
 * @module
 */

import { v } from "convex/values";

import { mutation, query } from "../functions";
import { recordSignInLimit, resetSignInLimit } from "../limits";
import { vAuthContinuationDoc } from "../model";

/** Create a short-lived provider continuation. */
export const create = mutation({
  args: {
    userId: v.id("User"),
    provider: v.string(),
    operation: v.literal("rotate"),
    expirationTime: v.number(),
  },
  returns: v.id("AuthContinuation"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("AuthContinuation", args);
  },
});

/**
 * Verify and consume a password-reset code, then stage its password change for
 * one passkey rotation. This operation never creates a session; the rotation
 * completion is the sole point that issues the recovered session.
 */
export const recover = mutation({
  args: {
    accountId: v.id("Account"),
    code: v.string(),
    identifier: v.optional(v.string()),
    maxAttemptsPerHour: v.number(),
    now: v.number(),
    passwordProvider: v.string(),
    provider: v.string(),
    resetProvider: v.string(),
    secret: v.string(),
    verifier: v.optional(v.string()),
    expirationTime: v.number(),
    operation: v.literal("rotate"),
  },
  returns: v.union(
    v.object({ status: v.literal("rejected") }),
    v.object({ status: v.literal("limited") }),
    v.object({
      status: v.literal("accepted"),
      continuationId: v.id("AuthContinuation"),
      userId: v.id("User"),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.identifier !== undefined) {
      const limit = await recordSignInLimit(ctx, {
        identifier: args.identifier,
        maxAttemptsPerHour: args.maxAttemptsPerHour,
      });
      if (!limit.ok) return { status: "limited" as const };
    }

    const account = await ctx.db.get("Account", args.accountId);
    if (account === null || account.provider !== args.passwordProvider) {
      return { status: "rejected" as const };
    }
    const code = await ctx.db
      .query("VerificationCode")
      .withIndex("code", (q) => q.eq("code", args.code))
      .first();
    if (
      code === null ||
      code.accountId !== account._id ||
      code.provider !== args.resetProvider ||
      code.expirationTime < args.now ||
      code.verifier !== args.verifier
    ) {
      return { status: "rejected" as const };
    }

    const accountKey = `accountId:${account._id}`;
    if (accountKey !== args.identifier) {
      const limit = await recordSignInLimit(ctx, {
        identifier: accountKey,
        maxAttemptsPerHour: args.maxAttemptsPerHour,
      });
      if (!limit.ok) return { status: "limited" as const };
    }

    const user = await ctx.db.get("User", account.userId);
    if (user === null) return { status: "rejected" as const };
    const active = await ctx.db
      .query("AuthContinuation")
      .withIndex("user_id_provider_operation_expiration_time", (q) =>
        q
          .eq("userId", user._id)
          .eq("provider", args.provider)
          .eq("operation", args.operation)
          .gt("expirationTime", args.now),
      )
      .first();
    if (active !== null) {
      const limitKeys = new Set([accountKey]);
      if (args.identifier !== undefined) limitKeys.add(args.identifier);
      for (const key of limitKeys) await resetSignInLimit(ctx, key);
      return { status: "rejected" as const };
    }

    await ctx.db.delete("VerificationCode", code._id);
    const limitKeys = new Set([accountKey]);
    if (args.identifier !== undefined) limitKeys.add(args.identifier);
    for (const key of limitKeys) await resetSignInLimit(ctx, key);

    const continuationId = await ctx.db.insert("AuthContinuation", {
      userId: user._id,
      provider: args.provider,
      operation: args.operation,
      expirationTime: args.expirationTime,
    });
    await ctx.db.insert("PasswordReset", {
      continuationId,
      accountId: account._id,
      secret: args.secret,
    });
    return { status: "accepted" as const, continuationId, userId: user._id };
  },
});

/** Read an unexpired continuation by id. */
export const get = query({
  args: { id: v.id("AuthContinuation") },
  returns: v.union(vAuthContinuationDoc, v.null()),
  handler: async (ctx, { id }) => {
    const continuation = await ctx.db.get("AuthContinuation", id);
    return continuation !== null && continuation.expirationTime >= Date.now() ? continuation : null;
  },
});
