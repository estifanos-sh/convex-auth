/**
 * `component.token.pkce.*` — PKCE verifiers.
 *
 * Reads collapse into one overloaded `get`.
 *
 * @module
 */

import { getOneFrom } from "convex-helpers/server/relationships";
import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import { vAuthVerifierDoc } from "../documents";
import schema from "../schema";

const DEFAULT_VERIFIER_TTL_MS = 1000 * 60 * 15;

/**
 * Read a verifier by `id` or `signature`, returning `null` once expired.
 * Accepts exactly one selector.
 */
export const get = query({
  args: {
    selector: v.union(
      v.object({ id: schema.id("AuthVerifier") }),
      v.object({ signature: v.string() }),
    ),
    now: v.number(),
  },
  returns: v.union(vAuthVerifierDoc, v.null()),
  handler: async (ctx, { selector, now }) => {
    if ("signature" in selector) {
      const verifier = await getOneFrom(ctx.db, "AuthVerifier", "signature", selector.signature);
      if (verifier?.expirationTime !== undefined && verifier.expirationTime < now) {
        return null;
      }
      return verifier;
    }
    const verifier = await ctx.db.get("AuthVerifier", selector.id);
    if (verifier?.expirationTime !== undefined && verifier.expirationTime < now) {
      return null;
    }
    return verifier;
  },
});

/**
 * Atomically consume a verifier: read → validate → delete in ONE transaction,
 * returning the consumed doc to the single winner and `null` to everyone else
 * (unknown / expired / signature mismatch / already consumed).
 *
 * The passkey and TOTP ceremonies run in actions, where reading the verifier
 * (`get`) and deleting it (`remove`) are two separate transactions: two
 * concurrent requests carrying the same verifier could both pass the read +
 * signature check before either delete landed, each then minting its own
 * session (duplicate sign-in). Folding read + optional signature match + delete
 * into this single mutation makes the row's transaction the serialization
 * point — the first caller deletes and returns the doc; a racing caller retries
 * under OCC, re-reads the now-absent row, and gets `null`.
 *
 * A signature mismatch does NOT delete the row (a wrong guess must not burn a
 * legitimate pending verifier); an expired row IS deleted but reported as not
 * consumed.
 */
export const consume = mutation({
  args: {
    selector: v.union(
      v.object({ id: schema.id("AuthVerifier") }),
      v.object({ signature: v.string() }),
    ),
    expectedSignature: v.optional(v.string()),
  },
  returns: v.union(vAuthVerifierDoc, v.null()),
  handler: async (ctx, { selector, expectedSignature }) => {
    const verifier =
      "signature" in selector
        ? await getOneFrom(ctx.db, "AuthVerifier", "signature", selector.signature)
        : await ctx.db.get("AuthVerifier", selector.id);
    if (verifier === null) return null;
    if (verifier.expirationTime !== undefined && verifier.expirationTime < Date.now()) {
      await ctx.db.delete("AuthVerifier", verifier._id);
      return null;
    }
    if (expectedSignature !== undefined && verifier.signature !== expectedSignature) {
      return null;
    }
    await ctx.db.delete("AuthVerifier", verifier._id);
    return verifier;
  },
});

/** Create a PKCE verifier, defaulting `expirationTime` to 15 minutes out. */
export const create = mutation({
  args: {
    sessionId: v.optional(v.id("Session")),
    continuationId: v.optional(v.id("AuthContinuation")),
    signature: v.optional(v.string()),
    expirationTime: v.optional(v.number()),
  },
  returns: v.id("AuthVerifier"),
  handler: async (ctx, { sessionId, continuationId, signature, expirationTime }) => {
    return await ctx.db.insert("AuthVerifier", {
      sessionId: sessionId,
      continuationId,
      signature,
      expirationTime: expirationTime ?? Date.now() + DEFAULT_VERIFIER_TTL_MS,
    });
  },
});

/** Patch a verifier in place. */
export const update = mutation({
  args: {
    id: v.id("AuthVerifier"),
    patch: v.object({
      sessionId: v.optional(v.id("Session")),
      continuationId: v.optional(v.id("AuthContinuation")),
      signature: v.optional(v.string()),
      expirationTime: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id: verifierId, patch }) => {
    await ctx.db.patch("AuthVerifier", verifierId, patch);
    return null;
  },
});

/** Delete a verifier by id. */
const remove = mutation({
  args: { id: v.id("AuthVerifier") },
  returns: v.null(),
  handler: async (ctx, { id: verifierId }) => {
    await ctx.db.delete("AuthVerifier", verifierId);
    return null;
  },
});

export { remove };
