/**
 * Credentials verification backed by two aggregate component transactions:
 * one to reserve/load sign-in state and one to refund-or-issue. This avoids a
 * separate component call for every account, user, factor, limiter, and session
 * operation.
 *
 * @internal
 */

import type { GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import * as Provider from "../../crypto";
import type { Hashed } from "../../../shared/brand";
import { queueAuthEvent } from "../../events";
import { maxSignInAttempts } from "../../limits";
import { LOG_LEVELS, log, maybeRedact } from "../../log";
import {
  buildSessionIdentity,
  getAuthSessionId,
  sessionExpirationTime,
} from "../../session/lifecycle";
import type { SessionIssuance } from "../../session/lifecycle";
import { encodeRefreshToken, refreshTokenExpirationTime } from "../../token/refresh";
import { buildKnownSignInIdentityAttributes } from "../../telemetry";
import {
  type CrossComponentUserDoc,
  GenericActionCtxWithAuthConfig,
  MutationCtx,
} from "../../types";
import { setActiveSpanAttributes, withSpan } from "../../utils/span";
import { AUTH_STORE_REF } from "../store/refs";

/**
 * A well-formed but intentionally unmatchable password hash. Verifying any
 * secret against it runs the provider's full (scrypt) work and always fails.
 * Used on the missing-account branch so sign-in spends comparable time whether
 * or not the account exists — closing the user-enumeration timing oracle.
 *
 * The prefix and params mirror the default password provider's scrypt format so
 * that provider performs a real scrypt hash; the salt and digest are all zero,
 * a digest scrypt can never actually produce, so verification never succeeds.
 */
const DUMMY_PASSWORD_HASH =
  `scrypt:N=16384,r=16,p=1,dkLen=64$${"0".repeat(64)}$${"0".repeat(128)}` as Hashed<"Password">;

/**
 * Run a throwaway secret verification purely to equalize timing on branches
 * that reject before the real verify would run. Never authenticates: it
 * verifies against {@link DUMMY_PASSWORD_HASH} (which cannot match) and swallows
 * any error, so a misconfigured or non-credentials provider still yields the
 * unified rejection rather than a distinguishable error or timing.
 */
async function burnVerifyForTiming(
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  providerId: string,
  secret: string,
): Promise<void> {
  try {
    await Provider.verify(getProviderOrThrow(providerId), secret, DUMMY_PASSWORD_HASH);
  } catch {
    // Intentionally ignored — this path exists only to equalize timing.
  }
}

/** Argument validator for the combined credentials-verify + session-issue mutation. */
export const vCredentialsSignInArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.string() }),
  generateTokens: v.boolean(),
  requireVerifiedEmail: v.boolean(),
  enforceTotp: v.boolean(),
});

type CredentialsSignInResult =
  | { kind: "invalidAccount" }
  | { kind: "tooManyAttempts" }
  | { kind: "invalidSecret" }
  | {
      kind: "emailVerificationRequired";
      account: { _id: string; emailVerified?: string };
      user: {
        _id: string;
        email?: string;
      };
    }
  | {
      kind: "signedIn";
      issuance: SessionIssuance;
      account: { _id: string; emailVerified?: string };
      user: {
        _id: string;
        email?: string;
        hasTotp?: boolean;
      };
    }
  | {
      kind: "totpRequired";
      account: { _id: string; emailVerified?: string };
      user: { _id: string; email?: string };
    };

/**
 * Verify credentials and issue a session through one app mutation.
 *
 * Enforces sign-in rate limiting, optional verified-email and TOTP gates, and
 * returns a discriminated result (`invalidAccount`, `tooManyAttempts`,
 * `invalidSecret`, `emailVerificationRequired`, `totpRequired`, or `signedIn`).
 *
 * @internal
 */
export async function credentialsSignInImpl(
  ctx: MutationCtx,
  args: Infer<typeof vCredentialsSignInArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<CredentialsSignInResult> {
  return withSpan(
    "convex-auth.mutations.credentialsSignIn",
    { provider: args.provider, generateTokens: args.generateTokens },
    () => credentialsSignInInner(ctx, args, getProviderOrThrow, config),
  );
}

async function credentialsSignInInner(
  ctx: MutationCtx,
  args: Infer<typeof vCredentialsSignInArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<CredentialsSignInResult> {
  const { provider: providerId, account, generateTokens, requireVerifiedEmail, enforceTotp } = args;
  log(LOG_LEVELS.DEBUG, "credentialsSignInImpl args:", {
    provider: providerId,
    account: { id: account.id, secret: maybeRedact(account.secret) },
    generateTokens,
    requireVerifiedEmail,
    enforceTotp,
  });

  const begun = (await ctx.runMutation(config.component.account.beginCredentialsSignIn, {
    provider: providerId,
    providerAccountId: account.id,
    maxAttemptsPerHour: maxSignInAttempts(config),
    reserveAttempt: true,
    includeTotp: enforceTotp,
  })) as
    | { status: "invalid" }
    | { status: "limited" }
    | {
        status: "ready";
        account: {
          _id: string;
          userId: string;
          secret?: string;
          emailVerified?: string;
        };
        user: CrossComponentUserDoc;
        hasTotp: boolean;
      };
  if (begun.status === "invalid") {
    // A real account pays the full secret-verify (scrypt) cost below, so burn
    // the same cost here before returning the unified rejection. Without this a
    // missing account returns early and its faster response leaks (by timing)
    // that the account does not exist. Result intentionally ignored.
    await burnVerifyForTiming(getProviderOrThrow, providerId, account.secret);
    return { kind: "invalidAccount" };
  }
  if (begun.status === "limited") {
    return { kind: "tooManyAttempts" };
  }
  const existingAccount = begun.account;
  const user = begun.user;

  const verified = await withSpan("convex-auth.credentials.verify", { providerId }, () =>
    Provider.verify(
      getProviderOrThrow(providerId),
      account.secret,
      (existingAccount.secret ?? "") as Hashed<"Password">,
    ),
  );
  if (!verified) {
    // beginCredentialsSignIn reserved this failed attempt transactionally.
    return { kind: "invalidSecret" };
  }

  const complete = async (issueSession: boolean) =>
    (await ctx.runMutation(config.component.account.completeCredentialsSignIn, {
      accountId: existingAccount._id,
      issueSession,
      generateTokens,
      replaceSessionId: issueSession ? ((await getAuthSessionId(ctx)) ?? undefined) : undefined,
      sessionExpirationTime: sessionExpirationTime(config),
      refreshTokenExpirationTime: refreshTokenExpirationTime(config),
    })) as
      | { status: "rejected" | "reset" }
      | {
          status: "accepted";
          user: typeof user;
          sessionId: string;
          refreshTokenId?: string;
          replacedSessionId?: string;
        };

  if (requireVerifiedEmail && !existingAccount.emailVerified) {
    await complete(false);
    return {
      kind: "emailVerificationRequired",
      account: {
        _id: existingAccount._id,
        emailVerified: existingAccount.emailVerified,
      },
      user: {
        _id: user._id,
        email: user.email,
      },
    };
  }

  if (enforceTotp && begun.hasTotp) {
    await complete(false);
    return {
      kind: "totpRequired",
      account: {
        _id: existingAccount._id,
        emailVerified: existingAccount.emailVerified,
      },
      user: { _id: user._id, email: user.email },
    };
  }

  const completed = await complete(true);
  if (completed.status !== "accepted") return { kind: "invalidAccount" };

  const userId = completed.user._id as GenericId<"User">;
  const sessionId = completed.sessionId as GenericId<"Session">;
  setActiveSpanAttributes({
    "auth.signin.result": "success",
    ...buildKnownSignInIdentityAttributes(config, { userId, sessionId }, completed.user.email),
  });
  if (completed.replacedSessionId !== undefined) {
    const replacedSessionId = completed.replacedSessionId as GenericId<"Session">;
    await queueAuthEvent(ctx, config, {
      kind: "session.invalidated",
      actor: { type: "system" },
      subject: { type: "session", id: replacedSessionId },
      targets: [
        { kind: "user", id: userId },
        { kind: "session", id: replacedSessionId },
      ],
      outcome: "success",
      data: { userId, reason: "replaced" },
    });
  }
  await queueAuthEvent(ctx, config, {
    kind: "session.signed_in",
    actor: { type: "user", id: userId },
    subject: { type: "session", id: sessionId },
    targets: [
      { kind: "user", id: userId },
      { kind: "session", id: sessionId },
    ],
    outcome: "success",
    data: { provider: providerId },
  });
  const refreshTokenId = completed.refreshTokenId as GenericId<"RefreshToken"> | undefined;
  const issuance: SessionIssuance = {
    userId,
    sessionId,
    identity: buildSessionIdentity(userId, sessionId, completed.user),
    refreshToken:
      generateTokens && refreshTokenId !== undefined
        ? encodeRefreshToken(refreshTokenId, sessionId)
        : null,
  };

  return {
    kind: "signedIn",
    issuance,
    account: {
      _id: existingAccount._id,
      emailVerified: existingAccount.emailVerified,
    },
    user: {
      _id: user._id,
      email: user.email,
      hasTotp: begun.hasTotp,
    },
  };
}

/** @internal */
export const callCredentialsSignIn = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtxWithAuthConfig<DataModel>,
  args: Infer<typeof vCredentialsSignInArgs>,
): Promise<CredentialsSignInResult> => {
  return (await ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "credentialsSignIn",
      ...args,
    },
  })) as CredentialsSignInResult;
};
