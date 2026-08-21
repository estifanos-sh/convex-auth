import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  GenericActionCtx,
  GenericDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";

import type { AuthComponentApi } from "./component/api";
import type { Doc } from "./types";

type RunCtx = GenericActionCtx<GenericDataModel>;
type ComponentRunContext = {
  runQuery: RunCtx["runQuery"];
  runMutation: RunCtx["runMutation"];
  runAction?: RunCtx["runAction"];
};

/** @internal */
export type AuthComponentBoundaryConfig = { component: AuthComponentApi };

function runQuery<Ref extends FunctionReference<"query", "public" | "internal">>(
  ctx: ComponentRunContext,
  ref: Ref,
  args: FunctionArgs<Ref>,
): Promise<FunctionReturnType<Ref>> {
  return ctx.runQuery(ref, args) as Promise<FunctionReturnType<Ref>>;
}

function runMutation<Ref extends FunctionReference<"mutation", "public" | "internal">>(
  ctx: ComponentRunContext,
  ref: Ref,
  args: FunctionArgs<Ref>,
): Promise<FunctionReturnType<Ref>> {
  return ctx.runMutation(ref, args) as Promise<FunctionReturnType<Ref>>;
}

/**
 * Component boundary adapter: calls cross the isolated Convex component
 * boundary as string IDs, then domain code re-brands them to typed `Doc`s
 * inward.
 *
 * @internal
 */
export function authDb(ctx: ComponentRunContext, config: AuthComponentBoundaryConfig) {
  const component = config.component;
  return {
    users: {
      get: (args: { id: string } | { verifiedEmail: string } | { verifiedPhone: string }) =>
        runQuery(ctx, component.user.get, args) as Promise<Doc<"User"> | null>,
      create: (data: Record<string, unknown>) =>
        runMutation(ctx, component.user.create, { data }) as Promise<string>,
      update: (userId: string, data: Record<string, unknown>) =>
        runMutation(ctx, component.user.update, { id: userId, patch: data }),
      upsert: (userId: string | undefined, data: Record<string, unknown>) =>
        runMutation(ctx, component.user.upsert, {
          id: userId,
          data,
        }),
    },
    emails: {
      upsert: (args: {
        userId: string;
        email: string;
        verified?: boolean;
        isPrimary?: boolean;
        source: "password" | "oauth" | "oidc" | "saml" | "scim";
        accountId?: string;
        provider?: string;
        connectionId?: string;
      }) => runMutation(ctx, component.user.email.upsert, args),
      listByUser: (userId: string) =>
        runQuery(ctx, component.user.email.list, { userId }) as Promise<Doc<"UserEmail">[]>,
    },
    accounts: {
      get: (args: { id: string } | { provider: string; providerAccountId: string }) =>
        runQuery(ctx, component.account.get, args) as Promise<Doc<"Account"> | null>,
      create: (args: {
        userId: string;
        provider: string;
        providerAccountId: string;
        secret?: string;
        extend?: Record<string, unknown>;
      }) => runMutation(ctx, component.account.create, args),
      update: (accountId: string, data: Record<string, unknown>) =>
        runMutation(ctx, component.account.update, { id: accountId, patch: data }),
      delete: (accountId: string) => runMutation(ctx, component.account.remove, { id: accountId }),
    },
    sessions: {
      create: (args: {
        userId: string;
        sessionId?: string;
        replaceSessionId?: string;
        sessionExpirationTime: number;
        refreshTokenExpirationTime?: number;
      }) =>
        runMutation(ctx, component.session.create, args) as Promise<{
          userId: GenericId<"User">;
          sessionId: GenericId<"Session">;
          refreshTokenId?: GenericId<"RefreshToken">;
          replacedSessionId?: GenericId<"Session">;
          user: Doc<"User">;
        }>,
      get: (sessionId: string) =>
        runQuery(ctx, component.session.get, { id: sessionId }) as Promise<Doc<"Session"> | null>,
      delete: (sessionId: string) => runMutation(ctx, component.session.remove, { id: sessionId }),
      listByUser: (userId: string) =>
        runQuery(ctx, component.session.list, { userId }) as Promise<Doc<"Session">[]>,
    },
    factors: {
      getPasskey: (passkeyId: string) =>
        runQuery(ctx, component.factor.passkey.get, {
          id: passkeyId,
        }) as Promise<Doc<"Passkey"> | null>,
      getTotp: (totpId: string) =>
        runQuery(ctx, component.factor.totp.get, {
          id: totpId,
        }) as Promise<Doc<"TotpFactor"> | null>,
    },
    verifiers: {
      create: (sessionId?: string, signature?: string, expirationTime?: number) =>
        runMutation(ctx, component.token.pkce.create, {
          sessionId,
          signature,
          expirationTime,
        }),
      get: (args: { id: string } | { signature: string }) =>
        runQuery(ctx, component.token.pkce.get, args) as Promise<Doc<"AuthVerifier"> | null>,
      update: (verifierId: string, data: Record<string, unknown>) =>
        runMutation(ctx, component.token.pkce.update, { id: verifierId, patch: data }),
      delete: (verifierId: string) =>
        runMutation(ctx, component.token.pkce.remove, { id: verifierId }),
    },
    verificationCodes: {
      get: (args: { accountId: string } | { code: string }) =>
        runQuery(
          ctx,
          component.token.verification.get,
          args,
        ) as Promise<Doc<"VerificationCode"> | null>,
      create: (args: {
        accountId: string;
        provider: string;
        code: string;
        expirationTime: number;
        verifier?: string;
        emailVerified?: string;
        phoneVerified?: string;
      }) =>
        runMutation(ctx, component.token.verification.create, args) as Promise<
          Doc<"VerificationCode">["_id"]
        >,
      delete: (verificationCodeId: string) =>
        runMutation(ctx, component.token.verification.remove, {
          id: verificationCodeId,
        }),
    },
    refreshTokens: {
      create: (args: {
        sessionId: string;
        expirationTime: number;
        parentRefreshTokenId?: string;
      }) => runMutation(ctx, component.token.refresh.create, args),
      exchange: (args: {
        refreshTokenId: string;
        sessionId: string;
        now: number;
        refreshTokenExpirationTime: number;
        reuseWindowMs: number;
      }) =>
        runMutation(ctx, component.token.refresh.exchange!, args) as Promise<
          | {
              status: "rotated";
              userId: string;
              user: Doc<"User">;
              sessionId: string;
              refreshTokenId: string;
            }
          | { status: "reuse_detected"; userId: string; refreshTokenId: string }
          | { status: "invalid" }
        >,
      get: (refreshTokenId: string) =>
        runQuery(ctx, component.token.refresh.get, {
          id: refreshTokenId,
        }) as Promise<Doc<"RefreshToken"> | null>,
      update: (refreshTokenId: string, data: Record<string, unknown>) =>
        runMutation(ctx, component.token.refresh.update, {
          id: refreshTokenId,
          patch: data,
        }),
      getChildren: (sessionId: string, parentRefreshTokenId: string) =>
        runQuery(ctx, component.token.refresh.list, {
          sessionId,
          parentRefreshTokenId,
        }) as Promise<Doc<"RefreshToken">[]>,
      listBySession: (sessionId: string) =>
        runQuery(ctx, component.token.refresh.list, { sessionId }) as Promise<
          Doc<"RefreshToken">[]
        >,
      deleteAll: (sessionId: string) =>
        runMutation(ctx, component.token.refresh.remove, { sessionId }),
      getActive: (sessionId: string) =>
        runQuery(ctx, component.token.refresh.get, {
          activeForSession: sessionId,
        }) as Promise<Doc<"RefreshToken"> | null>,
    },
  };
}
