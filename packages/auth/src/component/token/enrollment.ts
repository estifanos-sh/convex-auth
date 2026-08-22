/**
 * `component.token.enrollment.*` — staged credentials enrollment state.
 *
 * @module
 */

import { v } from "convex/values";

import { vCredentialEnrollmentDoc } from "../documents";
import { mutation, query } from "../_generated/server";
import { vPayloadRecord } from "../model";

/** Stage a hashed credentials identity for exactly one passkey rotation. */
export const create = mutation({
  args: {
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
    profile: vPayloadRecord,
    shouldLinkViaEmail: v.boolean(),
    shouldLinkViaPhone: v.boolean(),
    targetProvider: v.string(),
    expirationTime: v.number(),
  },
  returns: v.id("AuthContinuation"),
  handler: async (ctx, args) => {
    const { targetProvider, ...enrollment } = args;
    const enrollmentId = await ctx.db.insert("CredentialEnrollment", enrollment);
    return await ctx.db.insert("AuthContinuation", {
      subject: { kind: "enrollment", enrollmentId },
      provider: targetProvider,
      operation: "rotate",
      expirationTime: args.expirationTime,
    });
  },
});

/** Resolve the unexpired staged state bound to a provider continuation. */
export const get = query({
  args: {
    continuationId: v.id("AuthContinuation"),
    provider: v.string(),
    now: v.number(),
  },
  returns: v.union(vCredentialEnrollmentDoc, v.null()),
  handler: async (ctx, args) => {
    const continuation = await ctx.db.get("AuthContinuation", args.continuationId);
    if (
      continuation === null ||
      continuation.subject.kind !== "enrollment" ||
      continuation.provider !== args.provider ||
      continuation.operation !== "rotate" ||
      continuation.expirationTime < args.now
    ) {
      return null;
    }
    const enrollment = await ctx.db.get("CredentialEnrollment", continuation.subject.enrollmentId);
    return enrollment !== null && enrollment.expirationTime >= args.now ? enrollment : null;
  },
});
