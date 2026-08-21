/**
 * `component.token.continuation.*` — provider enrollment continuations.
 *
 * @module
 */

import { v } from "convex/values";

import { mutation, query } from "../functions";
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

/** Create a continuation with a password update committed on completion. */
export const createPasswordReset = mutation({
  args: {
    userId: v.id("User"),
    provider: v.string(),
    operation: v.literal("rotate"),
    expirationTime: v.number(),
    accountId: v.id("Account"),
    secret: v.string(),
  },
  returns: v.id("AuthContinuation"),
  handler: async (ctx, args) => {
    const account = await ctx.db.get("Account", args.accountId);
    if (account === null || account.userId !== args.userId) {
      throw new Error("Password reset account does not belong to the continuation user.");
    }
    const continuationId = await ctx.db.insert("AuthContinuation", {
      userId: args.userId,
      provider: args.provider,
      operation: args.operation,
      expirationTime: args.expirationTime,
    });
    await ctx.db.insert("PasswordReset", {
      continuationId,
      accountId: account._id,
      secret: args.secret,
    });
    return continuationId;
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
