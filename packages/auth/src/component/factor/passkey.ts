/**
 * `component.factor.passkey.*` — WebAuthn passkey credentials.
 *
 * Reads collapse into one overloaded `get`; `update`
 * also carries the post-assertion counter sync (clone detection).
 *
 * @module
 */

import { getOneFrom } from "convex-helpers/server/relationships";
import { ConvexError, v } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import { MAX_WEBAUTHN_CREDENTIALS_PER_USER } from "../../shared/webauthn";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { mutation, query } from "../functions";
import { vPasskeyDoc, vUserDoc } from "../model";
import { createSessionRows } from "../session";

const PASSKEY_LIST_BATCH = 128;

/**
 * Consume a WebAuthn challenge and load its credential in one transaction.
 *
 * A corrupt duplicate credential is deliberately projected as unknown instead
 * of throwing: the challenge still burns, and callers retain the same external
 * failure shape for real and unknown credential ids.
 */
export const beginAssertion = mutation({
  args: {
    verifierId: v.id("AuthVerifier"),
    expectedChallenge: v.string(),
    credentialId: v.string(),
  },
  returns: v.object({
    verifierAccepted: v.boolean(),
    passkey: v.union(vPasskeyDoc, v.null()),
  }),
  handler: async (ctx, { verifierId, expectedChallenge, credentialId }) => {
    const [verifier, passkeys] = await Promise.all([
      ctx.db.get("AuthVerifier", verifierId),
      ctx.db
        .query("Passkey")
        .withIndex("credential_id", (q) => q.eq("credentialId", credentialId))
        .take(2),
    ]);

    const expired = verifier?.expirationTime !== undefined && verifier.expirationTime < Date.now();
    const verifierAccepted =
      verifier !== null && !expired && verifier.signature === expectedChallenge;
    if (expired) {
      await ctx.db.delete("AuthVerifier", verifierId);
    } else if (verifierAccepted) {
      await ctx.db.delete("AuthVerifier", verifierId);
    }

    return {
      verifierAccepted,
      passkey: passkeys.length === 1 ? passkeys[0] : null,
    };
  },
});

async function acceptPasskeyCounter(
  ctx: MutationCtx,
  args: {
    id: Id<"Passkey">;
    counter: number;
    lastUsedAt: number;
    backedUp: boolean;
  },
) {
  const current = await ctx.db.get("Passkey", args.id);
  if (current === null) return null;
  if ((current.counter !== 0 || args.counter !== 0) && args.counter <= current.counter) {
    return null;
  }
  await ctx.db.patch("Passkey", args.id, {
    counter: args.counter,
    lastUsedAt: args.lastUsedAt,
    backedUp: args.backedUp,
  });
  return current;
}

/** Read a passkey by `id`, or by its WebAuthn `credentialId`. */
export const get = query({
  args: {
    id: v.optional(v.id("Passkey")),
    credentialId: v.optional(v.string()),
  },
  returns: v.union(vPasskeyDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.credentialId !== undefined) {
      return await getOneFrom(
        ctx.db,
        "Passkey",
        "credential_id",
        args.credentialId,
        "credentialId",
      );
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("Passkey", args.id);
  },
});

/** List all passkeys for a user. */
export const list = query({
  args: { userId: v.id("User") },
  returns: v.array(vPasskeyDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("Passkey")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .take(PASSKEY_LIST_BATCH);
  },
});

/**
 * Insert a new passkey credential, deduped by `credentialId`.
 *
 * Reading the `credential_id` index range for the incoming credential
 * establishes the OCC read dependency that serializes two concurrent
 * registrations of the same credential: the loser re-runs, sees the winner's
 * row, and (for the same user) returns it instead of inserting a duplicate.
 * Without this guard a duplicate row makes the `get({ credentialId })`
 * `.unique()` lookup throw on every later sign-in — a permanent lockout for that
 * credential.
 */
export const create = mutation({
  args: {
    userId: v.id("User"),
    credentialId: v.string(),
    publicKey: v.bytes(),
    algorithm: v.number(),
    counter: v.number(),
    transports: v.optional(v.array(v.string())),
    deviceType: v.string(),
    backedUp: v.boolean(),
    name: v.optional(v.string()),
    attestation: v.optional(
      v.object({
        verifier: v.string(),
        aaguid: v.string(),
        format: v.string(),
        metadataDescription: v.optional(v.string()),
        verifiedAt: v.number(),
        status: v.literal("trusted"),
      }),
    ),
    createdAt: v.number(),
  },
  returns: v.id("Passkey"),
  handler: async (ctx, args) => {
    const linkedAccounts = await Promise.all(
      ["passkey", "webauthn"].map((provider) =>
        ctx.db
          .query("Account")
          .withIndex("provider_account_id", (q) =>
            q.eq("provider", provider).eq("providerAccountId", args.credentialId),
          )
          .first(),
      ),
    );
    for (const account of linkedAccounts) {
      if (account !== null && account.userId !== args.userId) {
        throw new ConvexError({
          code: ErrorCode.ACCOUNT_ALREADY_LINKED,
          message: "This passkey credential is already registered to another account.",
          credentialId: args.credentialId,
        });
      }
    }

    const existing = await ctx.db
      .query("Passkey")
      .withIndex("credential_id", (q) => q.eq("credentialId", args.credentialId))
      .first();
    if (existing !== null) {
      if (existing.userId !== args.userId) {
        throw new ConvexError({
          code: ErrorCode.ACCOUNT_ALREADY_LINKED,
          message: "This passkey credential is already registered to another account.",
          credentialId: args.credentialId,
        });
      }
      if (linkedAccounts[0] === null) {
        await ctx.db.insert("Account", {
          userId: args.userId,
          provider: "passkey",
          providerAccountId: args.credentialId,
        });
      }
      // Same user re-submitting the same credential (a double-clicked or raced
      // registration): idempotent — return the credential already stored rather
      // than inserting a duplicate.
      if (args.attestation !== undefined) {
        await ctx.db.patch("Passkey", existing._id, { attestation: args.attestation });
      }
      return existing._id;
    }
    const userPasskeys = await ctx.db
      .query("Passkey")
      .withIndex("user_id", (q) => q.eq("userId", args.userId))
      .take(MAX_WEBAUTHN_CREDENTIALS_PER_USER);
    if (userPasskeys.length >= MAX_WEBAUTHN_CREDENTIALS_PER_USER) {
      throw new ConvexError({
        code: ErrorCode.INVALID_PARAMETERS,
        message: `A user can register at most ${MAX_WEBAUTHN_CREDENTIALS_PER_USER} WebAuthn credentials.`,
      });
    }
    const passkeyId = await ctx.db.insert("Passkey", args);
    if (linkedAccounts[0] === null) {
      await ctx.db.insert("Account", {
        userId: args.userId,
        provider: "passkey",
        providerAccountId: args.credentialId,
      });
    }
    return passkeyId;
  },
});

/** Patch fields on a passkey, including the post-assertion `counter` sync used for clone detection. */
export const update = mutation({
  args: {
    id: v.id("Passkey"),
    patch: v.object({
      counter: v.optional(v.number()),
      transports: v.optional(v.array(v.string())),
      name: v.optional(v.string()),
      lastUsedAt: v.optional(v.number()),
      backedUp: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id: passkeyId, patch }) => {
    await ctx.db.patch("Passkey", passkeyId, patch);
    return null;
  },
});

/**
 * Atomically accept a cryptographically verified assertion's signature
 * counter. For authenticators that support counters (`counter > 0`), only a
 * value strictly greater than the latest stored value is accepted; a racing
 * assertion that verified against a stale read returns `false` instead of
 * minting another session. Counterless authenticators (`0`) remain supported.
 */
export const acceptAssertion = mutation({
  args: {
    id: v.id("Passkey"),
    counter: v.number(),
    lastUsedAt: v.number(),
    backedUp: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return (await acceptPasskeyCounter(ctx, args)) !== null;
  },
});

/**
 * Accept a verified assertion and create its session in one transaction.
 *
 * The signature is checked by the calling action before this mutation. The
 * stored counter is re-read here so a concurrent assertion can never mint a
 * session from stale anti-cloning state.
 */
export const completeAssertion = mutation({
  args: {
    id: v.id("Passkey"),
    counter: v.number(),
    lastUsedAt: v.number(),
    backedUp: v.boolean(),
    replaceSessionId: v.optional(v.id("Session")),
    sessionExpirationTime: v.number(),
    refreshTokenExpirationTime: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("rejected") }),
    v.object({
      status: v.literal("accepted"),
      user: vUserDoc,
      sessionId: v.id("Session"),
      refreshTokenId: v.id("RefreshToken"),
      replacedSessionId: v.optional(v.id("Session")),
    }),
  ),
  handler: async (ctx, args) => {
    const passkey = await acceptPasskeyCounter(ctx, args);
    if (passkey === null) return { status: "rejected" as const };

    const created = await createSessionRows(ctx, {
      userId: passkey.userId,
      replaceSessionId: args.replaceSessionId,
      sessionExpirationTime: args.sessionExpirationTime,
      refreshTokenExpirationTime: args.refreshTokenExpirationTime,
    });
    if (created === null || created.refreshTokenId === undefined) {
      throw new Error("Cannot create a session for the asserted passkey");
    }
    return {
      status: "accepted" as const,
      user: created.user,
      sessionId: created.sessionId,
      refreshTokenId: created.refreshTokenId,
      ...(created.replacedSessionId === undefined
        ? {}
        : { replacedSessionId: created.replacedSessionId }),
    };
  },
});

/** Delete a passkey credential. */
const remove = mutation({
  args: { id: v.id("Passkey") },
  returns: v.null(),
  handler: async (ctx, { id: passkeyId }) => {
    const passkey = await ctx.db.get("Passkey", passkeyId);
    if (passkey === null) return null;
    for (const provider of ["passkey", "webauthn"]) {
      const accounts = await ctx.db
        .query("Account")
        .withIndex("provider_account_id", (q) =>
          q.eq("provider", provider).eq("providerAccountId", passkey.credentialId),
        )
        .take(PASSKEY_LIST_BATCH);
      for (const account of accounts) {
        if (account.userId === passkey.userId) {
          await ctx.db.delete("Account", account._id);
        }
      }
    }
    await ctx.db.delete("Passkey", passkeyId);
    return null;
  },
});

export { remove };
