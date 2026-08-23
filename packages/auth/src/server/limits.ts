import { hmac } from "@oslojs/crypto/hmac";
import { SHA256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import type {
  FunctionReference,
  FunctionReturnType,
  FunctionVisibility,
  OptionalRestArgs,
} from "convex/server";

import { requireAuthKey } from "./env";
import type { ConvexAuthConfig } from "./types";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

/**
 * Minimal context the rate-limit helpers depend on. The component API is
 * threaded in via the explicit `config` argument, so only `runQuery` /
 * `runMutation` are required. Typed with the narrowest call shape the helpers
 * actually use so both mutation handlers (credentials sign-in) and action
 * handlers (the TOTP ceremony) satisfy it, despite their differing
 * `runQuery`/`runMutation` option overloads.
 *
 * @internal
 */
export type SignInLimitCtx = {
  runQuery: <Query extends FunctionReference<"query", FunctionVisibility>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation: <Mutation extends FunctionReference<"mutation", FunctionVisibility>>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
};

/**
 * Minimal config shape the rate-limit helpers depend on. Both
 * {@link ConvexAuthConfig} and `ConvexAuthMaterializedConfig` satisfy it, so
 * the helpers work from mutation and action handlers alike.
 *
 * @internal
 */
export type SignInLimitConfig = Pick<ConvexAuthConfig, "component" | "signIn">;

/** Resolve the configured guessable-secret attempt capacity. @internal */
export function maxSignInAttempts(config: SignInLimitConfig) {
  return config.signIn?.maxFailedAttemptsPerHour ?? DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR;
}

/**
 * Produce the opaque token-bucket key for a credentials sign-in identity.
 *
 * The component persists this value, so it must never contain the submitted
 * account identifier. It is deliberately derived before account lookup: known
 * and unknown accounts then consume the same bucket. The normalized identifier
 * treats user-facing credential IDs consistently without changing provider
 * account lookup semantics.
 *
 * @internal
 */
export function credentialsSignInLimitIdentifier(provider: string, accountId: string) {
  const canonical = JSON.stringify([provider, accountId.trim().toLowerCase()]);
  return encodeHexLowerCase(
    hmac(
      SHA256,
      new TextEncoder().encode(requireAuthKey("webauthnMaskingKey")),
      new TextEncoder().encode(`credentials-sign-in:${canonical}`),
    ),
  );
}

/**
 * Check whether the given identifier is currently rate-limited.
 *
 * @internal
 */
export async function isSignInRateLimited(
  ctx: SignInLimitCtx,
  identifier: string,
  config: SignInLimitConfig,
): Promise<boolean> {
  const { ok } = await ctx.runQuery(config.component.limits.signInCheck, {
    identifier,
    maxAttemptsPerHour: maxSignInAttempts(config),
    now: Date.now(),
  });
  return !ok;
}

/**
 * Record a failed sign-in attempt for the given identifier.
 *
 * @internal
 */
export async function recordFailedSignIn(
  ctx: SignInLimitCtx,
  identifier: string,
  config: SignInLimitConfig,
): Promise<void> {
  await ctx.runMutation(config.component.limits.signInRecord, {
    identifier,
    maxAttemptsPerHour: maxSignInAttempts(config),
  });
}

/**
 * Reserve one sign-in attempt up front, consuming a token as part of the same
 * atomic component mutation. Returns `true` when the caller is **blocked** (the
 * bucket was already empty, so no token was taken) and `false` when a token was
 * successfully consumed and the caller may proceed.
 *
 * Unlike {@link isSignInRateLimited} — a non-consuming peek — this closes the
 * check-then-record TOCTOU that lets N concurrent guesses in an **action**
 * (TOTP / passkey verify) all pass a `check()` before any `limit()` commits.
 * Reserving before the verification makes each attempt consume a token
 * atomically, so the per-hour cap bounds *attempts*, not merely logged failures.
 *
 * A single normal attempt consumes exactly one token; callers refund it on a
 * successful verification via {@link resetSignInRateLimit}. On a failed
 * verification the caller must NOT also call {@link recordFailedSignIn} — the
 * reservation already counted the attempt.
 *
 * @internal
 */
export async function reserveSignInAttempt(
  ctx: SignInLimitCtx,
  identifier: string,
  config: SignInLimitConfig,
): Promise<boolean> {
  const { ok } = await ctx.runMutation(config.component.limits.signInRecord, {
    identifier,
    maxAttemptsPerHour: maxSignInAttempts(config),
  });
  return !ok;
}

/**
 * Reset the rate limit for the given identifier.
 *
 * @internal
 */
export async function resetSignInRateLimit(
  ctx: SignInLimitCtx,
  identifier: string,
  config: SignInLimitConfig,
): Promise<void> {
  await ctx.runMutation(config.component.limits.signInReset, { identifier });
}
