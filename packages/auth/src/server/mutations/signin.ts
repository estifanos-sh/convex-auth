import type { GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { queueAuthEvent } from "../events";
import { LOG_LEVELS } from "../log";
import { log } from "../log";
import {
  finalizeSessionIssuance,
  getAuthSessionReplacement,
  issueSession,
} from "../session/lifecycle";
import type { SessionIssuance } from "../session/lifecycle";
import { buildKnownSignInIdentityAttributes } from "../telemetry";
import { GenericActionCtxWithAuthConfig, MutationCtx, SessionInfo } from "../types";
import { setActiveSpanAttributes, withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const vSignInArgs = v.object({
  userId: v.string(),
  sessionId: v.optional(v.string()),
  provider: v.string(),
  generateTokens: v.boolean(),
});

export async function signInSessionImpl(
  ctx: MutationCtx,
  args: Infer<typeof vSignInArgs>,
  config: Provider.Config,
): Promise<SessionIssuance> {
  return withSpan(
    "convex-auth.mutations.signIn",
    {
      "auth.flow": "signIn",
      provider: args.provider,
      hasExistingSession: args.sessionId !== undefined,
      generateTokens: args.generateTokens,
    },
    async () => {
      log(LOG_LEVELS.DEBUG, "signInSessionImpl args:", args);
      const { userId, sessionId: existingSessionId, provider, generateTokens } = args;
      const typedUserId = userId as GenericId<"User">;
      const replaceSession =
        existingSessionId === undefined ? await getAuthSessionReplacement(ctx) : undefined;
      const issuance = await issueSession(ctx, config, {
        userId: typedUserId,
        existingSessionId: existingSessionId as GenericId<"Session"> | undefined,
        replaceSession,
        generateTokens,
      });
      setActiveSpanAttributes({
        "auth.signin.result": "success",
        ...buildKnownSignInIdentityAttributes(
          config,
          {
            userId: issuance.userId,
            sessionId: issuance.sessionId,
          },
          issuance.identity.email,
        ),
      });
      await queueAuthEvent(ctx, config, {
        kind: "session.signed_in",
        actor: { type: "user", id: issuance.userId },
        subject: { type: "session", id: issuance.sessionId },
        targets: [
          { kind: "user", id: issuance.userId },
          { kind: "session", id: issuance.sessionId },
        ],
        outcome: "success",
        data: { provider },
      });
      return issuance;
    },
  );
}

/**
 * Run the sign-in mutation, then sign the JWT on the action side.
 *
 * Splitting the work like this keeps the 5–30ms of RSA-2048 CPU out of the
 * mutation transaction so the mutation can commit quickly even on a cold
 * worker. The refresh-token string itself is cheap to compute and stays
 * inside the mutation (returned on the {@link SessionIssuance}); only the
 * JWT signing moves here.
 *
 * @internal
 */
export const callSignIn = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtxWithAuthConfig<DataModel>,
  args: Infer<typeof vSignInArgs>,
): Promise<SessionInfo> => {
  const issuance = (await ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "signIn",
      ...args,
    },
  })) as SessionIssuance;
  return await finalizeSessionIssuance(ctx.auth.config, issuance);
};
