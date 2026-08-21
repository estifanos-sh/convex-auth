/**
 * `component.token.verification.*` — OTP / magic-link / OAuth codes.
 *
 * Reads collapse into one overloaded `get`.
 *
 * @module
 */

import { getOneFrom } from "convex-helpers/server/relationships";
import { v } from "convex/values";

import { mutation, query } from "../functions";
import { recordSignInLimit, resetSignInLimit } from "../limits";
import { vAccountDoc, vUserDoc, vVerificationCodeDoc } from "../model";
import { createSessionRows } from "../session";

/** Reserve verification attempts and resolve a valid code plus account atomically. */
export const beginVerification = mutation({
  args: {
    code: v.string(),
    identifier: v.optional(v.string()),
    verifier: v.optional(v.string()),
    provider: v.optional(v.string()),
    maxAttemptsPerHour: v.number(),
    now: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("invalid") }),
    v.object({ status: v.literal("limited") }),
    v.object({
      status: v.literal("ready"),
      code: vVerificationCodeDoc,
      account: vAccountDoc,
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

    const code = await ctx.db
      .query("VerificationCode")
      .withIndex("code", (q) => q.eq("code", args.code))
      .first();
    if (code === null) return { status: "invalid" as const };

    const accountKey = `accountId:${code.accountId}`;
    if (accountKey !== args.identifier) {
      const limit = await recordSignInLimit(ctx, {
        identifier: accountKey,
        maxAttemptsPerHour: args.maxAttemptsPerHour,
      });
      if (!limit.ok) return { status: "limited" as const };
    }

    if (
      code.verifier !== args.verifier ||
      code.expirationTime < args.now ||
      (args.provider !== undefined && code.provider !== args.provider)
    ) {
      return { status: "invalid" as const };
    }
    const account = await ctx.db.get("Account", code.accountId);
    return account === null
      ? { status: "invalid" as const }
      : { status: "ready" as const, code, account };
  },
});

/** Consume a verified code, clear its limits, and issue its session atomically. */
export const completeVerification = mutation({
  args: {
    codeId: v.id("VerificationCode"),
    userId: v.id("User"),
    identifier: v.optional(v.string()),
    replaceSessionId: v.optional(v.id("Session")),
    createSession: v.boolean(),
    generateTokens: v.boolean(),
    sessionExpirationTime: v.number(),
    refreshTokenExpirationTime: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("rejected") }),
    v.object({
      status: v.literal("verified"),
      user: vUserDoc,
    }),
    v.object({
      status: v.literal("signedIn"),
      user: vUserDoc,
      sessionId: v.id("Session"),
      refreshTokenId: v.optional(v.id("RefreshToken")),
      replacedSessionId: v.optional(v.id("Session")),
    }),
  ),
  handler: async (ctx, args) => {
    const code = await ctx.db.get("VerificationCode", args.codeId);
    if (code === null) return { status: "rejected" as const };

    await ctx.db.delete("VerificationCode", code._id);
    const limitKeys = new Set([`accountId:${code.accountId}`]);
    if (args.identifier !== undefined) limitKeys.add(args.identifier);
    for (const key of limitKeys) await resetSignInLimit(ctx, key);
    if (!args.createSession) {
      const user = await ctx.db.get("User", args.userId);
      return user === null
        ? { status: "rejected" as const }
        : { status: "verified" as const, user };
    }
    const created = await createSessionRows(ctx, {
      userId: args.userId,
      replaceSessionId: args.replaceSessionId,
      sessionExpirationTime: args.sessionExpirationTime,
      refreshTokenExpirationTime: args.generateTokens ? args.refreshTokenExpirationTime : undefined,
    });
    if (created === null) return { status: "rejected" as const };
    return {
      status: "signedIn" as const,
      user: created.user,
      sessionId: created.sessionId,
      ...(created.refreshTokenId === undefined ? {} : { refreshTokenId: created.refreshTokenId }),
      ...(created.replacedSessionId === undefined
        ? {}
        : { replacedSessionId: created.replacedSessionId }),
    };
  },
});

/** Refund a valid code attempt when later provider or provisioning work fails. */
export const resetVerificationLimits = mutation({
  args: {
    accountId: v.id("Account"),
    identifier: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const limitKeys = new Set([`accountId:${args.accountId}`]);
    if (args.identifier !== undefined) limitKeys.add(args.identifier);
    for (const key of limitKeys) await resetSignInLimit(ctx, key);
    return null;
  },
});

/**
 * Read a verification code by raw `code` or by `accountId`.
 * Accepts exactly one selector.
 */
export const get = query({
  args: {
    accountId: v.optional(v.id("Account")),
    code: v.optional(v.string()),
  },
  returns: v.union(vVerificationCodeDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.code !== undefined) {
      return await ctx.db
        .query("VerificationCode")
        .withIndex("code", (q) => q.eq("code", args.code!))
        .first();
    }
    if (args.accountId === undefined) return null;
    return await getOneFrom(ctx.db, "VerificationCode", "account_id", args.accountId, "accountId");
  },
});

/** Create a verification code for an account. Returns the new id. */
export const create = mutation({
  args: {
    accountId: v.id("Account"),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  },
  returns: v.id("VerificationCode"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("VerificationCode", args);
  },
});

/** Delete a verification code by id. */
const remove = mutation({
  args: { id: v.id("VerificationCode") },
  returns: v.null(),
  handler: async (ctx, { id: verificationCodeId }) => {
    await ctx.db.delete("VerificationCode", verificationCodeId);
    return null;
  },
});

export { remove };
