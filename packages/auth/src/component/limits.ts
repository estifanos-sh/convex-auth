/**
 * `component.limits.*` — sign-in token buckets stored with auth state.
 *
 * @module
 */

import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

const HOUR_MS = 60 * 60 * 1000;

const args = {
  identifier: v.string(),
  maxAttemptsPerHour: v.number(),
  now: v.number(),
};

const returns = v.object({
  ok: v.boolean(),
  retryAfter: v.optional(v.number()),
});

type LimitCtx = Pick<QueryCtx, "db">;

async function readBucket(ctx: LimitCtx, identifier: string) {
  return await ctx.db
    .query("SignInLimit")
    .withIndex("identifier", (q) => q.eq("identifier", identifier))
    .unique();
}

function bucketStatus(
  bucket: Awaited<ReturnType<typeof readBucket>>,
  maxAttemptsPerHour: number,
  now: number,
) {
  const capacity = Math.max(0, maxAttemptsPerHour);
  if (capacity === 0) return { tokens: 0, retryAfter: HOUR_MS };
  const elapsed = bucket === null ? 0 : Math.max(0, now - bucket.updatedAt);
  const previous = bucket?.tokens ?? capacity;
  const tokens = Math.min(capacity, previous + (elapsed * capacity) / HOUR_MS);
  const retryAfter = tokens >= 1 ? undefined : Math.ceil(((1 - tokens) * HOUR_MS) / capacity);
  return { tokens, retryAfter };
}

/** Read token-bucket headroom without another component call. @internal */
export async function checkSignInLimit(
  ctx: LimitCtx,
  input: { identifier: string; maxAttemptsPerHour: number; now: number },
) {
  const status = bucketStatus(
    await readBucket(ctx, input.identifier),
    input.maxAttemptsPerHour,
    input.now,
  );
  return { ok: status.tokens >= 1, retryAfter: status.retryAfter };
}

/** Consume one guessable-secret attempt in the caller's mutation. @internal */
export async function recordSignInLimit(
  ctx: MutationCtx,
  input: { identifier: string; maxAttemptsPerHour: number },
) {
  const now = Date.now();
  const bucket = await readBucket(ctx, input.identifier);
  const status = bucketStatus(bucket, input.maxAttemptsPerHour, now);
  if (status.tokens < 1) {
    if (bucket !== null) {
      await ctx.db.patch("SignInLimit", bucket._id, { tokens: status.tokens, updatedAt: now });
    }
    return { ok: false, retryAfter: status.retryAfter };
  }

  const tokens = status.tokens - 1;
  if (bucket === null) {
    await ctx.db.insert("SignInLimit", { identifier: input.identifier, tokens, updatedAt: now });
  } else {
    await ctx.db.patch("SignInLimit", bucket._id, { tokens, updatedAt: now });
  }
  return { ok: true, retryAfter: undefined };
}

/** Clear a token bucket in the caller's mutation. @internal */
export async function resetSignInLimit(ctx: MutationCtx, identifier: string) {
  const bucket = await readBucket(ctx, identifier);
  if (bucket !== null) await ctx.db.delete("SignInLimit", bucket._id);
}

/** Peek at sign-in rate-limit headroom for `identifier` without consuming a token. */
export const signInCheck = query({
  args,
  returns,
  handler: checkSignInLimit,
});

/** Consume one sign-in token for `identifier`; `ok: false` when throttled. */
export const signInRecord = mutation({
  args: {
    identifier: v.string(),
    maxAttemptsPerHour: v.number(),
  },
  returns,
  handler: recordSignInLimit,
});

/** Clear the sign-in rate-limit counter for `identifier` after success. */
export const signInReset = mutation({
  args: { identifier: v.string() },
  returns: v.null(),
  handler: async (ctx, { identifier }) => {
    await resetSignInLimit(ctx, identifier);
    return null;
  },
});
