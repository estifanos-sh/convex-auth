/**
 * `component.factor.passkey.*` — WebAuthn passkey credentials.
 *
 * Reads collapse into one overloaded `get`; `update`
 * also carries the post-assertion counter sync (clone detection).
 *
 * @module
 */

import { getOneFrom } from "convex-helpers/server/relationships";
import { ConvexError, type Infer, v } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import { MAX_WEBAUTHN_CREDENTIALS_PER_USER } from "../../shared/webauthn";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { mutation, query } from "../functions";
import { vPasskeyDoc, vUserDoc } from "../model";
import { createSessionRows, revokeSessionRows } from "../session";

const PASSKEY_LIST_BATCH = 128;
const DEFAULT_VERIFIER_TTL_MS = 15 * 60 * 1000;

const vPasskeyCreateArgs = v.object({
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
});

async function createVerifier(
  ctx: MutationCtx,
  args: {
    signature: string;
    expirationTime?: number;
  } & (
    | { binding: "session"; sessionId?: Id<"Session"> }
    | { binding: "continuation"; continuationId: Id<"AuthContinuation"> }
  ),
) {
  return await ctx.db.insert("AuthVerifier", {
    ...(args.binding === "session"
      ? { sessionId: args.sessionId }
      : { continuationId: args.continuationId }),
    signature: args.signature,
    expirationTime: args.expirationTime ?? Date.now() + DEFAULT_VERIFIER_TTL_MS,
  });
}

async function listPasskeys(ctx: MutationCtx, userId: Id<"User">) {
  return await ctx.db
    .query("Passkey")
    .withIndex("user_id", (q) => q.eq("userId", userId))
    .take(PASSKEY_LIST_BATCH);
}

/** Create a registration challenge and load the user and existing credentials atomically. */
export const beginRegistration = mutation({
  args: {
    userId: v.id("User"),
    sessionId: v.optional(v.id("Session")),
    signature: v.string(),
    expirationTime: v.number(),
  },
  returns: v.object({
    verifierId: v.id("AuthVerifier"),
    user: v.object({
      email: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
    credentials: v.array(
      v.object({
        id: v.string(),
        transports: v.optional(v.array(v.string())),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const [user, passkeys] = await Promise.all([
      ctx.db.get("User", args.userId),
      listPasskeys(ctx, args.userId),
    ]);
    if (user === null) {
      throw new Error(`Cannot register a passkey for missing user ${args.userId}`);
    }
    const verifierId = await createVerifier(ctx, { ...args, binding: "session" });
    return {
      verifierId,
      user: {
        ...(user.email === undefined ? {} : { email: user.email }),
        ...(user.name === undefined ? {} : { name: user.name }),
      },
      credentials: passkeys.map((passkey) => ({
        id: passkey.credentialId,
        ...(passkey.transports === undefined ? {} : { transports: passkey.transports }),
      })),
    };
  },
});

/** Create a registration challenge from an unexpired rotation continuation. */
export const beginRotation = mutation({
  args: {
    continuationId: v.id("AuthContinuation"),
    provider: v.string(),
    signature: v.string(),
    expirationTime: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("rejected") }),
    v.object({
      status: v.literal("accepted"),
      userId: v.id("User"),
      verifierId: v.id("AuthVerifier"),
      user: v.object({
        email: v.optional(v.string()),
        name: v.optional(v.string()),
      }),
      credentials: v.array(
        v.object({
          id: v.string(),
          transports: v.optional(v.array(v.string())),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const continuation = await ctx.db.get("AuthContinuation", args.continuationId);
    if (
      continuation === null ||
      continuation.expirationTime < Date.now() ||
      continuation.provider !== args.provider ||
      continuation.operation !== "rotate"
    ) {
      return { status: "rejected" as const };
    }
    const user = await ctx.db.get("User", continuation.userId);
    if (user === null) return { status: "rejected" as const };
    const credentials = await listPasskeys(ctx, user._id);
    const verifierId = await createVerifier(ctx, {
      binding: "continuation",
      continuationId: continuation._id,
      signature: args.signature,
      expirationTime: Math.min(args.expirationTime, continuation.expirationTime),
    });
    return {
      status: "accepted" as const,
      userId: user._id,
      verifierId,
      user: {
        ...(user.email === undefined ? {} : { email: user.email }),
        ...(user.name === undefined ? {} : { name: user.name }),
      },
      credentials: credentials.map((credential) => ({
        id: credential.credentialId,
        ...(credential.transports === undefined ? {} : { transports: credential.transports }),
      })),
    };
  },
});

/** Create an assertion challenge and resolve an optional email allow-list in one transaction. */
export const beginSignIn = mutation({
  args: {
    sessionId: v.optional(v.id("Session")),
    signature: v.string(),
    expirationTime: v.number(),
    verifiedEmail: v.optional(v.string()),
  },
  returns: v.object({
    verifierId: v.id("AuthVerifier"),
    credentials: v.array(
      v.object({
        id: v.string(),
        transports: v.optional(v.array(v.string())),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    let user: Infer<typeof vUserDoc> | null = null;
    let passkeys: Array<Infer<typeof vPasskeyDoc>> = [];
    if (args.verifiedEmail !== undefined) {
      const users = await ctx.db
        .query("User")
        .withIndex("email_verified", (q) =>
          q.eq("email", args.verifiedEmail!).gt("emailVerificationTime", undefined),
        )
        .take(2);
      user = users.length === 1 ? users[0] : null;
      if (user !== null) {
        passkeys = await listPasskeys(ctx, user._id);
      }
    }
    const verifierId = await createVerifier(ctx, { ...args, binding: "session" });
    return {
      verifierId,
      credentials: passkeys.map((passkey) => ({
        id: passkey.credentialId,
        ...(passkey.transports === undefined ? {} : { transports: passkey.transports }),
      })),
    };
  },
});

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
async function createPasskey(ctx: MutationCtx, args: Infer<typeof vPasskeyCreateArgs>) {
  const linkedAccount = await ctx.db
    .query("Account")
    .withIndex("provider_account_id", (q) =>
      q.eq("provider", "passkey").eq("providerAccountId", args.credentialId),
    )
    .first();
  const linkedAccounts = [linkedAccount];
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
}

export const create = mutation({
  args: vPasskeyCreateArgs,
  returns: v.id("Passkey"),
  handler: createPasskey,
});

/** Store a verified registration and replace its current session in one transaction. */
export const completeRegistration = mutation({
  args: {
    ...vPasskeyCreateArgs.fields,
    replaceSessionId: v.optional(v.id("Session")),
    sessionExpirationTime: v.number(),
    refreshTokenExpirationTime: v.number(),
  },
  returns: v.object({
    passkeyId: v.id("Passkey"),
    user: vUserDoc,
    sessionId: v.id("Session"),
    refreshTokenId: v.id("RefreshToken"),
    replacedSessionId: v.optional(v.id("Session")),
  }),
  handler: async (ctx, args) => {
    const { replaceSessionId, sessionExpirationTime, refreshTokenExpirationTime, ...passkey } =
      args;
    const passkeyId = await createPasskey(ctx, passkey);
    const created = await createSessionRows(ctx, {
      userId: passkey.userId,
      replaceSessionId,
      sessionExpirationTime,
      refreshTokenExpirationTime,
    });
    if (created === null || created.refreshTokenId === undefined) {
      throw new Error("Cannot create a session for the registered passkey");
    }
    return {
      passkeyId,
      user: created.user,
      sessionId: created.sessionId,
      refreshTokenId: created.refreshTokenId,
      ...(created.replacedSessionId === undefined
        ? {}
        : { replacedSessionId: created.replacedSessionId }),
    };
  },
});

/** Rotate a user's passkeys, revoke prior sessions, and create the final session. */
export const completeRotation = mutation({
  args: {
    ...vPasskeyCreateArgs.fields,
    continuationId: v.id("AuthContinuation"),
    provider: v.string(),
    sessionExpirationTime: v.number(),
    refreshTokenExpirationTime: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("rejected") }),
    v.object({
      status: v.literal("accepted"),
      passkeyId: v.id("Passkey"),
      user: vUserDoc,
      sessionId: v.id("Session"),
      refreshTokenId: v.id("RefreshToken"),
      removedPasskeyIds: v.array(v.id("Passkey")),
      revokedSessions: v.number(),
      passwordChanged: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const continuation = await ctx.db.get("AuthContinuation", args.continuationId);
    if (
      continuation === null ||
      continuation.expirationTime < Date.now() ||
      continuation.userId !== args.userId ||
      continuation.provider !== args.provider ||
      continuation.operation !== "rotate"
    ) {
      return { status: "rejected" as const };
    }

    const oldPasskeys = await listPasskeys(ctx, continuation.userId);
    for (const passkey of oldPasskeys) await ctx.db.delete("Passkey", passkey._id);
    const accounts = await ctx.db
      .query("Account")
      .withIndex("user_id_provider", (q) =>
        q.eq("userId", continuation.userId).eq("provider", "passkey"),
      )
      .take(PASSKEY_LIST_BATCH);
    for (const account of accounts) await ctx.db.delete("Account", account._id);

    const {
      continuationId,
      provider: _provider,
      sessionExpirationTime,
      refreshTokenExpirationTime,
      ...data
    } = args;
    const passkeyId = await createPasskey(ctx, data);
    const revokedSessions = await revokeSessionRows(ctx, continuation.userId);
    const passwordReset = await ctx.db
      .query("PasswordReset")
      .withIndex("continuation_id", (q) => q.eq("continuationId", continuationId))
      .unique();
    if (passwordReset !== null) {
      const account = await ctx.db.get("Account", passwordReset.accountId);
      if (account === null || account.userId !== continuation.userId) {
        throw new Error("Password reset account no longer belongs to the continuation user.");
      }
      await ctx.db.patch("Account", account._id, { secret: passwordReset.secret });
      await ctx.db.delete("PasswordReset", passwordReset._id);
    }
    await ctx.db.delete("AuthContinuation", continuationId);
    const created = await createSessionRows(ctx, {
      userId: continuation.userId,
      sessionExpirationTime,
      refreshTokenExpirationTime,
    });
    if (created === null || created.refreshTokenId === undefined) {
      throw new Error("Cannot create a session for the rotated passkey");
    }
    return {
      status: "accepted" as const,
      passkeyId,
      user: created.user,
      sessionId: created.sessionId,
      refreshTokenId: created.refreshTokenId,
      removedPasskeyIds: oldPasskeys.map((passkey) => passkey._id),
      revokedSessions,
      passwordChanged: passwordReset !== null,
    };
  },
});

/** Patch fields on a passkey, including the post-assertion `counter` sync used for clone detection. */
export const update = mutation({
  args: {
    id: v.id("Passkey"),
    userId: v.optional(v.id("User")),
    patch: v.object({
      counter: v.optional(v.number()),
      transports: v.optional(v.array(v.string())),
      name: v.optional(v.string()),
      lastUsedAt: v.optional(v.number()),
      backedUp: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id: passkeyId, userId, patch }) => {
    if (userId !== undefined) {
      const passkey = await ctx.db.get("Passkey", passkeyId);
      if (passkey === null || passkey.userId !== userId) {
        throw new ConvexError({
          code: ErrorCode.PASSKEY_NOT_FOUND,
          message: "Passkey not found.",
        });
      }
    }
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
  args: {
    id: v.id("Passkey"),
    userId: v.optional(v.id("User")),
    requireOtherAccount: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id: passkeyId, userId, requireOtherAccount }) => {
    const passkey = await ctx.db.get("Passkey", passkeyId);
    if (passkey === null) {
      if (userId !== undefined) {
        throw new ConvexError({
          code: ErrorCode.PASSKEY_NOT_FOUND,
          message: "Passkey not found.",
        });
      }
      return null;
    }
    if (userId !== undefined && passkey.userId !== userId) {
      throw new ConvexError({
        code: ErrorCode.PASSKEY_NOT_FOUND,
        message: "Passkey not found.",
      });
    }
    const linkedAccounts = [];
    const accounts = await ctx.db
      .query("Account")
      .withIndex("provider_account_id", (q) =>
        q.eq("provider", "passkey").eq("providerAccountId", passkey.credentialId),
      )
      .take(PASSKEY_LIST_BATCH);
    linkedAccounts.push(...accounts);
    if (requireOtherAccount === true) {
      const linkedIds = new Set(linkedAccounts.map((account) => account._id));
      const otherAccount = await ctx.db
        .query("Account")
        .withIndex("user_id_provider", (q) => q.eq("userId", passkey.userId))
        .take(PASSKEY_LIST_BATCH);
      if (!otherAccount.some((account) => !linkedIds.has(account._id))) {
        throw new ConvexError({
          code: ErrorCode.INVALID_PARAMETERS,
          message: "Cannot remove the user's last sign-in method.",
        });
      }
    }
    for (const account of linkedAccounts) {
      if (account.userId === passkey.userId) {
        await ctx.db.delete("Account", account._id);
      }
    }
    await ctx.db.delete("Passkey", passkeyId);
    return null;
  },
});

export { remove };
