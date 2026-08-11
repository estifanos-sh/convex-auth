import type { GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import type { Hashed } from "../../shared/brand";
import * as Provider from "../crypto";
import { requireAuthKey, requireEnv } from "../env";
import { queueAuthEvent } from "../events";
import { maxSignInAttempts } from "../limits";
import { LOG_LEVELS, log } from "../log";
import type { SignInParams } from "../payloads";
import { vPayloadRecord } from "../payloads";
import { sha256 } from "../random";
import {
  buildSessionIdentity,
  finalizeSessionIssuance,
  getAuthSessionId,
  sessionExpirationTime,
} from "../session/lifecycle";
import type { SessionIssuance } from "../session/lifecycle";
import { encodeRefreshToken, refreshTokenExpirationTime } from "../token/refresh";
import { buildKnownSignInIdentityAttributes } from "../telemetry";
import { createSyntheticOAuthMaterializedConfig } from "../connection/oidc";
import { isGroupProviderId } from "../connection/shared";
import {
  type CrossComponentUserDoc,
  type Doc,
  GenericActionCtxWithAuthConfig,
  MutationCtx,
  SessionInfo,
} from "../types";
import { upsertUserAndAccount } from "../user/account";
import { setActiveSpanAttributes, withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const vVerifyCodeAndSignInArgs = v.object({
  params: vPayloadRecord,
  provider: v.optional(v.string()),
  verifier: v.optional(v.string()),
  generateTokens: v.boolean(),
  allowExtraProviders: v.boolean(),
});

type MutationReturnType = null | SessionIssuance;

export async function verifyCodeAndSignInImpl(
  ctx: MutationCtx,
  args: Infer<typeof vVerifyCodeAndSignInArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<MutationReturnType> {
  return withSpan(
    "convex-auth.mutations.verifyCodeAndSignIn",
    {
      provider: args.provider ?? "",
      generateTokens: args.generateTokens,
    },
    () => verifyCodeAndSignInImplInner(ctx, args, getProviderOrThrow, config),
  );
}

async function verifyCodeAndSignInImplInner(
  ctx: MutationCtx,
  args: Infer<typeof vVerifyCodeAndSignInArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<MutationReturnType> {
  const params = args.params as SignInParams;
  const { generateTokens, provider, allowExtraProviders } = args;
  const identifier: string | undefined =
    typeof params.email === "string"
      ? params.email
      : typeof params.phone === "string"
        ? params.phone
        : undefined;
  let resolvedAccountId: string | undefined;

  try {
    log(LOG_LEVELS.DEBUG, "verifyCodeAndSignInImpl args:", {
      params: { email: params.email, phone: params.phone },
      provider: args.provider,
      verifier: args.verifier,
      generateTokens: args.generateTokens,
      allowExtraProviders: args.allowExtraProviders,
    });
    if (generateTokens) {
      requireAuthKey("jwtPrivateKey");
      requireAuthKey("jwks");
      requireEnv("CONVEX_SITE_URL");
    }

    const verifier = args.verifier;
    const codeValue = params.code;
    const hash = (await sha256(
      typeof codeValue === "string" ? codeValue : "__invalid_verification_code__",
    )) as Hashed<"VerificationCode">;
    const begun = (await ctx.runMutation(config.component.token.verification.beginVerification, {
      code: hash,
      identifier,
      verifier,
      provider,
      maxAttemptsPerHour: maxSignInAttempts(config),
      now: Date.now(),
    })) as
      | { status: "invalid" | "limited" }
      | {
          status: "ready";
          code: {
            _id: string;
            provider: string;
            emailVerified?: string;
            phoneVerified?: string;
          };
          account: Doc<"Account">;
        };
    if (typeof codeValue !== "string" || begun.status !== "ready") {
      throw new VerifyFailure(
        begun.status === "limited" ? "Too many failed attempts to verify code" : "Invalid code",
      );
    }
    const { code, account } = begun;
    resolvedAccountId = account._id;

    const codeProvider = isGroupProviderId(code.provider)
      ? createSyntheticOAuthMaterializedConfig(code.provider)
      : getProviderOrThrow(code.provider, allowExtraProviders);

    if (
      codeProvider !== null &&
      (codeProvider.type === "email" || codeProvider.type === "phone") &&
      codeProvider.authorize !== undefined
    ) {
      await codeProvider.authorize(params, account);
    }

    const methodProvider = isGroupProviderId(account.provider)
      ? createSyntheticOAuthMaterializedConfig(account.provider)
      : getProviderOrThrow(account.provider);

    const replaceSessionId = await getAuthSessionId(ctx);
    const userId =
      methodProvider.type === "oauth"
        ? account.userId
        : (
            await upsertUserAndAccount(
              ctx,
              replaceSessionId,
              { existingAccount: account },
              {
                type: "verification",
                provider: methodProvider,
                profile: {
                  ...(code.emailVerified !== undefined
                    ? { email: code.emailVerified, emailVerified: true }
                    : {}),
                  ...(code.phoneVerified !== undefined
                    ? { phone: code.phoneVerified, phoneVerified: true }
                    : {}),
                },
              },
              config,
            )
          ).userId;

    const completed = (await ctx.runMutation(
      config.component.token.verification.completeVerification,
      {
        codeId: code._id,
        userId,
        identifier,
        replaceSessionId: replaceSessionId ?? undefined,
        generateTokens,
        sessionExpirationTime: sessionExpirationTime(config),
        refreshTokenExpirationTime: refreshTokenExpirationTime(config),
      },
    )) as
      | { status: "rejected" }
      | {
          status: "accepted";
          user: CrossComponentUserDoc;
          sessionId: string;
          refreshTokenId?: string;
          replacedSessionId?: string;
        };
    if (completed.status !== "accepted") throw new VerifyFailure("Invalid code");

    const typedUserId = completed.user._id as GenericId<"User">;
    const sessionId = completed.sessionId as GenericId<"Session">;
    setActiveSpanAttributes({
      "auth.signin.result": "success",
      ...buildKnownSignInIdentityAttributes(
        config,
        { userId: typedUserId, sessionId },
        completed.user.email,
      ),
    });
    if (completed.replacedSessionId !== undefined) {
      const replacedSessionId = completed.replacedSessionId as GenericId<"Session">;
      await queueAuthEvent(ctx, config, {
        kind: "session.invalidated",
        actor: { type: "system" },
        subject: { type: "session", id: replacedSessionId },
        targets: [
          { kind: "user", id: typedUserId },
          { kind: "session", id: replacedSessionId },
        ],
        outcome: "success",
        data: { userId: typedUserId, reason: "replaced" },
      });
    }
    await queueAuthEvent(ctx, config, {
      kind: "session.signed_in",
      actor: { type: "user", id: typedUserId },
      subject: { type: "session", id: sessionId },
      targets: [
        { kind: "user", id: typedUserId },
        { kind: "session", id: sessionId },
      ],
      outcome: "success",
      data: { provider: code.provider },
    });
    const refreshTokenId = completed.refreshTokenId as GenericId<"RefreshToken"> | undefined;
    return {
      userId: typedUserId,
      sessionId,
      identity: buildSessionIdentity(typedUserId, sessionId, completed.user),
      refreshToken:
        generateTokens && refreshTokenId !== undefined
          ? encodeRefreshToken(refreshTokenId, sessionId)
          : null,
    };
  } catch (error) {
    if (error instanceof VerifyFailure) {
      log(LOG_LEVELS.ERROR, error.reason);
      return null;
    }
    if (resolvedAccountId !== undefined) {
      try {
        await ctx.runMutation(config.component.token.verification.resetVerificationLimits, {
          accountId: resolvedAccountId,
          identifier,
        });
      } catch (resetError) {
        log(LOG_LEVELS.ERROR, "Failed to refund verification rate limit", resetError);
      }
    }
    throw error;
  }
}

/** A soft verification failure -- logged and collapsed to null at the boundary. */
class VerifyFailure extends Error {
  readonly _tag = "VerifyFailure";
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = "VerifyFailure";
  }
}

/**
 * Run the verify-code-and-sign-in mutation, then sign the JWT on the action
 * side. See {@link callSignIn} for the rationale — the mutation returns
 * `SessionIssuance` (cheap string-encoded refresh token + IDs), and this
 * wrapper does the RSA-2048 work outside the mutation transaction.
 *
 * @internal
 */
export const callVerifyCodeAndSignIn = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtxWithAuthConfig<DataModel>,
  args: Infer<typeof vVerifyCodeAndSignInArgs>,
): Promise<SessionInfo | null> => {
  const issuance = (await ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "verifyCodeAndSignIn",
      ...args,
    },
  })) as MutationReturnType;
  if (issuance === null) return null;
  return await finalizeSessionIssuance(ctx.auth.config, issuance);
};
