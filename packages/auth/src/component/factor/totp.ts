/**
 * `component.factor.totp.*` — TOTP (authenticator-app) enrollments.
 *
 * Reads collapse into one overloaded `get`. Enrollment is confirmed via
 * `update(id, { verified: true })`.
 *
 * @module
 */

import { v } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import { convexError } from "../../shared/errors";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { mutation, query } from "../_generated/server";
import { recordSignInLimit, resetSignInLimit } from "../limits";
import { vTotpFactorDoc, vUserDoc } from "../documents";
import { createSessionRows, vSessionReplacement } from "../session";

const TOTP_LIST_BATCH = 32;
const TOTP_VERIFIER_TTL_MS = 15 * 60 * 1000;

type TotpIntent = "enrollment" | "challenge";
type TotpVerifier = {
  userId: string;
  purpose?: "totp.setup";
  totpId?: string;
};

/** Create a TOTP factor and its enrollment verifier atomically. */
export const createEnrollment = mutation({
  args: {
    userId: v.id("User"),
    secret: v.bytes(),
    digits: v.number(),
    period: v.number(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.object({
    user: vUserDoc,
    totpId: v.id("TotpFactor"),
    verifierId: v.id("AuthVerifier"),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("User", args.userId);
    if (user === null) throw new Error(`Cannot enroll TOTP for missing user ${args.userId}`);
    const totpId = await ctx.db.insert("TotpFactor", {
      userId: args.userId,
      secret: args.secret,
      digits: args.digits,
      period: args.period,
      verified: false,
      name: args.name,
      createdAt: args.createdAt,
    });
    const verifierId = await ctx.db.insert("AuthVerifier", {
      signature: JSON.stringify({
        purpose: "totp.setup",
        userId: args.userId,
        totpId,
        digits: args.digits,
        period: args.period,
      }),
      expirationTime: args.createdAt + TOTP_VERIFIER_TTL_MS,
    });
    return { user, totpId, verifierId };
  },
});

function parseVerifier(signature: string | undefined): TotpVerifier | null {
  if (signature === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(signature);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as {
      userId?: unknown;
      purpose?: unknown;
      totpId?: unknown;
    };
    if (typeof candidate.userId !== "string" || candidate.userId.length === 0) return null;
    if (candidate.purpose !== undefined && candidate.purpose !== "totp.setup") return null;
    if (candidate.totpId !== undefined && typeof candidate.totpId !== "string") return null;

    const verifier: TotpVerifier = { userId: candidate.userId };
    if (candidate.purpose !== undefined) verifier.purpose = candidate.purpose;
    if (candidate.totpId !== undefined) verifier.totpId = candidate.totpId;
    return verifier;
  } catch {
    return null;
  }
}

async function resolveVerification(
  ctx: MutationCtx,
  args: {
    verifierId: Id<"AuthVerifier">;
    intent: TotpIntent;
    authenticatedUserId?: Id<"User">;
    totpId?: Id<"TotpFactor">;
  },
) {
  const verifier = await ctx.db.get("AuthVerifier", args.verifierId);
  if (verifier === null) return { status: "invalid_verifier" as const };
  if (verifier.expirationTime !== undefined && verifier.expirationTime < Date.now()) {
    await ctx.db.delete("AuthVerifier", verifier._id);
    return { status: "invalid_verifier" as const };
  }
  const data = parseVerifier(verifier.signature);
  if (data === null) return { status: "invalid_verifier" as const };

  if (args.intent === "enrollment") {
    if (
      args.authenticatedUserId === undefined ||
      args.totpId === undefined ||
      data.purpose !== "totp.setup" ||
      data.userId !== args.authenticatedUserId ||
      data.totpId !== args.totpId
    ) {
      return { status: "invalid_verifier" as const };
    }
    const factor = await ctx.db.get("TotpFactor", args.totpId);
    if (factor === null || factor.userId !== args.authenticatedUserId) {
      return { status: "not_found" as const };
    }
    if (factor.verified) return { status: "already_verified" as const };
    return { status: "ready" as const, userId: factor.userId, factor };
  }

  const userId = data.userId as Id<"User">;
  const factor = await ctx.db
    .query("TotpFactor")
    .withIndex("user_id_verified", (q) => q.eq("userId", userId).eq("verified", true))
    .first();
  if (factor === null) return { status: "not_found" as const };
  return { status: "ready" as const, userId, factor };
}

/** Validate a TOTP ceremony, reserve its attempt, and load its factor atomically. */
export const beginVerification = mutation({
  args: {
    verifierId: v.id("AuthVerifier"),
    intent: v.union(v.literal("enrollment"), v.literal("challenge")),
    authenticatedUserId: v.optional(v.id("User")),
    totpId: v.optional(v.id("TotpFactor")),
    maxAttemptsPerHour: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("invalid_verifier") }),
    v.object({ status: v.literal("limited") }),
    v.object({ status: v.literal("not_found") }),
    v.object({ status: v.literal("already_verified") }),
    v.object({
      status: v.literal("ready"),
      userId: v.id("User"),
      factor: vTotpFactorDoc,
    }),
  ),
  handler: async (ctx, args) => {
    const resolved = await resolveVerification(ctx, args);
    if (resolved.status !== "ready") return resolved;
    const limit = await recordSignInLimit(ctx, {
      identifier: resolved.userId,
      maxAttemptsPerHour: args.maxAttemptsPerHour,
    });
    return limit.ok ? resolved : { status: "limited" as const };
  },
});

/** Consume a verified TOTP ceremony and issue the session in one transaction. */
export const completeVerification = mutation({
  args: {
    verifierId: v.id("AuthVerifier"),
    intent: v.union(v.literal("enrollment"), v.literal("challenge")),
    authenticatedUserId: v.optional(v.id("User")),
    totpId: v.optional(v.id("TotpFactor")),
    replaceSession: v.optional(vSessionReplacement),
    sessionExpirationTime: v.number(),
    refreshTokenExpirationTime: v.number(),
    now: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("rejected") }),
    v.object({
      status: v.literal("accepted"),
      user: vUserDoc,
      factorId: v.id("TotpFactor"),
      sessionId: v.id("Session"),
      sessionExpirationTime: v.number(),
      refreshTokenId: v.id("RefreshToken"),
      replacedSessionId: v.optional(v.id("Session")),
    }),
  ),
  handler: async (ctx, args) => {
    const resolved = await resolveVerification(ctx, args);
    if (resolved.status !== "ready") return { status: "rejected" as const };

    await ctx.db.delete("AuthVerifier", args.verifierId);
    await resetSignInLimit(ctx, resolved.userId);
    await ctx.db.patch("TotpFactor", resolved.factor._id, {
      ...(args.intent === "enrollment" ? { verified: true } : {}),
      lastUsedAt: args.now,
    });
    const created = await createSessionRows(ctx, {
      userId: resolved.userId,
      replaceSession: args.replaceSession,
      sessionExpirationTime: args.sessionExpirationTime,
      refreshTokenExpirationTime: args.refreshTokenExpirationTime,
    });
    if (created === null || created.refreshTokenId === undefined) {
      return { status: "rejected" as const };
    }
    return {
      status: "accepted" as const,
      user: created.user,
      factorId: resolved.factor._id,
      sessionId: created.sessionId,
      sessionExpirationTime: created.sessionExpirationTime,
      refreshTokenId: created.refreshTokenId,
      ...(created.replacedSessionId === undefined
        ? {}
        : { replacedSessionId: created.replacedSessionId }),
    };
  },
});

/** Read a TOTP factor by `id`, or by `verifiedForUserId` (a user's confirmed enrollment). */
export const get = query({
  args: {
    id: v.optional(v.id("TotpFactor")),
    verifiedForUserId: v.optional(v.id("User")),
  },
  returns: v.union(vTotpFactorDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.verifiedForUserId !== undefined) {
      return await ctx.db
        .query("TotpFactor")
        .withIndex("user_id_verified", (q) =>
          q.eq("userId", args.verifiedForUserId!).eq("verified", true),
        )
        .first();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("TotpFactor", args.id);
  },
});

/** List all TOTP factors for a user. */
export const list = query({
  args: { userId: v.id("User") },
  returns: v.array(vTotpFactorDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("TotpFactor")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .take(TOTP_LIST_BATCH);
  },
});

/** Insert a new TOTP enrollment. */
export const create = mutation({
  args: {
    userId: v.id("User"),
    secret: v.bytes(),
    digits: v.number(),
    period: v.number(),
    verified: v.boolean(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id("TotpFactor"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("TotpFactor", args);
  },
});

/** Patch fields on a TOTP factor; setting `verified: true` confirms the enrollment. */
export const update = mutation({
  args: {
    id: v.id("TotpFactor"),
    userId: v.optional(v.id("User")),
    patch: v.object({
      verified: v.optional(v.boolean()),
      name: v.optional(v.string()),
      lastUsedAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id: totpId, userId, patch }) => {
    if (userId !== undefined) {
      const factor = await ctx.db.get("TotpFactor", totpId);
      if (factor === null || factor.userId !== userId) {
        throw convexError(ErrorCode.TOTP_NOT_FOUND, "TOTP factor not found.");
      }
    }
    await ctx.db.patch("TotpFactor", totpId, patch);
    return null;
  },
});

/** Delete a TOTP factor. */
const remove = mutation({
  args: { id: v.id("TotpFactor"), userId: v.optional(v.id("User")) },
  returns: v.null(),
  handler: async (ctx, { id: totpId, userId }) => {
    if (userId !== undefined) {
      const factor = await ctx.db.get("TotpFactor", totpId);
      if (factor === null || factor.userId !== userId) {
        throw convexError(ErrorCode.TOTP_NOT_FOUND, "TOTP factor not found.");
      }
    }
    await ctx.db.delete("TotpFactor", totpId);
    return null;
  },
});

export { remove };
