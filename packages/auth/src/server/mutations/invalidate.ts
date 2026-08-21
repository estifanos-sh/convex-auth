import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { emitAuthEvent } from "../events";
import { LOG_LEVELS } from "../log";
import { log } from "../log";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

export const vInvalidateSessionsArgs = v.object({
  userId: v.string(),
  except: v.optional(v.array(v.string())),
});

export const callInvalidateSessions = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof vInvalidateSessionsArgs>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "invalidateSessions",
      ...args,
    },
  }) as Promise<void>;
};

export async function invalidateSessionsImpl(
  ctx: MutationCtx,
  args: Infer<typeof vInvalidateSessionsArgs>,
  config: Provider.Config,
): Promise<void> {
  log(LOG_LEVELS.DEBUG, "invalidateSessionsImpl args:", args);
  const { userId, except } = args;
  const typedUserId = userId as GenericId<"User">;
  const revoked = await authDb(ctx, config).sessions.revokeForUser({
    userId: typedUserId,
    except,
  });
  for (const sessionId of revoked.cleanedSessionIds) {
    await emitAuthEvent(ctx, config, {
      kind: "session.invalidated",
      actor: { type: "system" },
      subject: { type: "session", id: sessionId },
      targets: [
        { kind: "user", id: typedUserId },
        { kind: "session", id: sessionId },
        { kind: "global", id: "security" },
      ],
      outcome: "success",
      data: { userId: typedUserId },
    });
  }
}
